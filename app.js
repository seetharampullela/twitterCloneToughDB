const express = require("express");
const app = express();
app.use(express.json());

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const path = require("path");
let db = null;

const dbPath = path.join(__dirname, "twitterClone.db");
const startServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("The server running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

startServer();
const getFollowingUserId = async (username) => {
  const getFollowerId = `
        SELECT following_user_id FROM follower
        INNER JOIN user ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';`;
  const followingData = await db.all(getFollowerId);
  const followingUsers = followingData.map(
    (eachUser) => eachUser.following_user_id
  );
  return followingUsers;
};

//Authenticate jwt token
const authenticateUser = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "Secret", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

//step1 register api
const checkLength = (password) => {
  return password.length > 5;
};
app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 15);
  const selectQuery = `SELECT * FROM user WHERE username='${username}';`;
  const dbUser = await db.get(selectQuery);

  if (dbUser === undefined) {
    if (checkLength(password)) {
      const createUserQuery = `
            INSERT INTO user(name,username,password,gender)
            VALUES (
                '${name}',
                '${username}',
                '${hashedPassword}',
                '${gender}'
            );`;
      const dbUser1 = await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//step 2 login api
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPwdMatch = await bcrypt.compare(password, dbUser.password);
    if (isPwdMatch === true) {
      const payload = { username: username, userId: dbUser.user_id };
      const jwtToken = await jwt.sign(payload, "Secret");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const tweetQuery = `SELECT
                            *
                        FROM tweet INNER JOIN follower
                        ON tweet.user_id = follower.following_user_id
                        WHERE tweet.tweet_id = '${tweetId}' 
                        AND follower_user_id = '${userId}';`;
  const tweet = await db.get(tweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//latest tweets
app.get("/user/tweets/feed/", authenticateUser, async (request, response) => {
  const { username } = request;
  const followingUserId = await getFollowingUserId(username);
  console.log(followingUserId);
  const selectTweetsQuery = `
        SELECT 
            username,tweet,date_time as dateTime
        FROM 
            user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE
            user.user_id IN (${followingUserId})
        ORDER BY date_time DESC
        LIMIT 4;`;
  const tweets = await db.all(selectTweetsQuery);
  response.send(tweets);
});

//user following
app.get("/user/following/", authenticateUser, async (request, response) => {
  const { username, userId } = request;
  const selectFollowerQuery = `
            SELECT distinct name FROM user 
            INNER JOIN follower ON user.user_id = follower.following_user_id
            WHERE follower_user_id = '${userId}';`;
  const dbUser = await db.all(selectFollowerQuery);
  response.send(dbUser);
});

//user followers
app.get("/user/followers/", authenticateUser, async (request, response) => {
  const { username, userId } = request;

  const selectFollowerQuery = `
            SELECT DISTINCT name FROM user INNER JOIN follower 
            ON user.user_id = follower.follower_user_id
            WHERE following_user_id = '${userId}';`;
  const dbUser = await db.all(selectFollowerQuery);
  response.send(dbUser);
});

//Tweet Id
app.get(
  "/tweets/:tweetId/",
  authenticateUser,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const followerQuery = `SELECT tweet,
    (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE tweet.tweet_id = '${tweetId}';`;
    const followerUser = await db.get(followerQuery);
    response.send(followerUser);
  }
);

///tweets/:tweetId/likes/
app.get(
  "/tweets/:tweetId/likes/",
  authenticateUser,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const followerQuery = `SELECT username FROM user 
    INNER JOIN like ON 
        user.user_id = like.user_id
    WHERE tweet_id = '${tweetId}'`;
    const followerUser = await db.all(followerQuery);
    const userName = followerUser.map((eachUser) => eachUser.username);
    response.send({ likes: userName });
  }
);

//
///tweets/:tweetId/replies/
app.get(
  "/tweets/:tweetId/replies/",
  authenticateUser,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const followerQuery = `SELECT name,reply 
    FROM user INNER JOIN reply 
    ON reply.user_id=user.user_id 
    WHERE tweet_id = '${tweetId}'`;
    const replies = await db.all(followerQuery);
    response.send({ replies: replies });
  }
);

///user/tweets/
app.get("/user/tweets/", authenticateUser, async (request, response) => {
  const { userId } = request;

  const getAllTweets = `
            SELECT tweet,count(DISTINCT like.like_id) as likes,
            count(DISTINCT reply.reply_id) as replies,
            date_time as dateTime
            FROM tweet LEFT JOIN reply ON tweet.tweet_id =reply.tweet_id
            LEFT JOIN like ON tweet.tweet_id = like.tweet_id
            WHERE tweet.user_id = '${userId}'
            GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getAllTweets);
  response.send(tweets);
});

//POST
app.post("/user/tweets/", authenticateUser, async (request, response) => {
  const { username } = request;
  const { tweet } = request.body;
  const userId = parseInt(request.userId);

  const dateTime = new Date().toJSON();
  const putRequest = `
            INSERT INTO tweet (tweet,user_id,date_time)
            VALUES(
                '${tweet}',
                '${userId}',
                '${dateTime}'
            )`;
  await db.run(putRequest);
  response.send("Created a Tweet");
});

//DELETE
app.delete("/tweets/:tweetId/", authenticateUser, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTweet = `SELECT * FROM tweet WHERE user_id = '${userId}'
AND tweet_id ='${tweetId}'`;
  const tweet = await db.get(getTweet);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteUserQuery = `
    DELETE FROM tweet WHERE tweet_id = '${tweetId}'`;
    await db.run(deleteUserQuery);
    response.send("Tweet Removed");
  }
});
module.exports = app;
