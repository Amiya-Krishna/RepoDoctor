import express from "express";

const app = express();

app.get(
  "/user",
  (req, res) => {
    const userId =
      req.query.userId;

    res.json({
      userId,
    });
  }
);

app.listen(3000);