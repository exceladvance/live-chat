import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(",") || "*",
    methods: ["GET", "POST"]
  }
});

const PORT = Number(process.env.PORT) || 4000;
const MESSAGE_LIMIT = 500;
const MIN_ACTION_MS = 300;

const state = {
  messages: [],
  polls: []
};

const rateLimiter = new Map();

app.use(cors());
app.get("/health", (_req, res) => res.json({ status: "ok" }));

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isAllowed(socketId, key) {
  const now = Date.now();
  const mapKey = `${socketId}:${key}`;
  const prev = rateLimiter.get(mapKey) || 0;

  if (now - prev < MIN_ACTION_MS) {
    return false;
  }

  rateLimiter.set(mapKey, now);
  return true;
}

function sanitizePollInput(payload) {
  const question = trimText(payload?.question).slice(0, 200);
  const options = Array.isArray(payload?.options)
    ? payload.options.map((option) => trimText(option).slice(0, 80)).filter(Boolean)
    : [];

  if (!question || options.length < 2 || options.length > 6) {
    return null;
  }

  return { question, options };
}

function getVisiblePoll(poll) {
  return {
    ...poll,
    votesByVoter: undefined
  };
}

io.on("connection", (socket) => {
  const name = trimText(socket.handshake.auth?.name).slice(0, 60) || "Guest";
  socket.data.name = name;
  socket.data.moderator = socket.handshake.auth?.moderator === true;

  socket.emit("session:init", {
    messages: state.messages,
    polls: state.polls.map(getVisiblePoll)
  });

  socket.on("chat:send", (payload, callback) => {
    if (!isAllowed(socket.id, "chat")) {
      callback?.({ ok: false, error: "You are sending too quickly." });
      return;
    }

    const text = trimText(payload?.messageText).slice(0, MESSAGE_LIMIT);
    if (!text) {
      callback?.({ ok: false, error: "Message cannot be empty." });
      return;
    }

    const message = {
      id: uid("msg"),
      senderName: name,
      messageText: text,
      timestamp: Date.now()
    };

    state.messages.push(message);
    if (state.messages.length > 2000) {
      state.messages.shift();
    }

    io.emit("chat:new", message);
    callback?.({ ok: true });
  });

  socket.on("poll:create", (payload, callback) => {
    if (!socket.data.moderator) {
      callback?.({ ok: false, error: "Moderator only action." });
      return;
    }

    if (!isAllowed(socket.id, "poll-create")) {
      callback?.({ ok: false, error: "Please wait before creating another poll." });
      return;
    }

    const clean = sanitizePollInput(payload);
    if (!clean) {
      callback?.({ ok: false, error: "Poll inputs are invalid." });
      return;
    }

    const poll = {
      pollId: uid("poll"),
      question: clean.question,
      options: clean.options.map((text, idx) => ({
        id: uid(`opt${idx}`),
        text,
        votesCount: 0
      })),
      createdAt: Date.now(),
      createdBy: name,
      status: "active",
      totalVotes: 0,
      votesByVoter: {}
    };

    state.polls.unshift(poll);
    io.emit("poll:new", getVisiblePoll(poll));
    callback?.({ ok: true });
  });

  socket.on("poll:vote", (payload, callback) => {
    if (!isAllowed(socket.id, "poll-vote")) {
      callback?.({ ok: false, error: "Voting too quickly." });
      return;
    }

    const pollId = trimText(payload?.pollId);
    const optionId = trimText(payload?.optionId);
    const voterKey = trimText(payload?.voterKey).slice(0, 100);

    if (!pollId || !optionId || !voterKey) {
      callback?.({ ok: false, error: "Missing vote payload." });
      return;
    }

    const poll = state.polls.find((item) => item.pollId === pollId);
    if (!poll || poll.status !== "active") {
      callback?.({ ok: false, error: "Poll is not active." });
      return;
    }

    const nextOption = poll.options.find((opt) => opt.id === optionId);
    if (!nextOption) {
      callback?.({ ok: false, error: "Option not found." });
      return;
    }

    const prevOptionId = poll.votesByVoter[voterKey];
    if (prevOptionId === optionId) {
      callback?.({ ok: true });
      return;
    }

    if (prevOptionId) {
      const prevOption = poll.options.find((opt) => opt.id === prevOptionId);
      if (prevOption && prevOption.votesCount > 0) {
        prevOption.votesCount -= 1;
      }
    } else {
      poll.totalVotes += 1;
    }

    poll.votesByVoter[voterKey] = optionId;
    nextOption.votesCount += 1;

    io.emit("poll:update", getVisiblePoll(poll));
    callback?.({ ok: true });
  });

  socket.on("poll:close", (payload, callback) => {
    if (!socket.data.moderator) {
      callback?.({ ok: false, error: "Moderator only action." });
      return;
    }

    const pollId = trimText(payload?.pollId);
    const poll = state.polls.find((item) => item.pollId === pollId);
    if (!poll) {
      callback?.({ ok: false, error: "Poll not found." });
      return;
    }

    poll.status = "closed";
    io.emit("poll:update", getVisiblePoll(poll));
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    for (const key of rateLimiter.keys()) {
      if (key.startsWith(`${socket.id}:`)) {
        rateLimiter.delete(key);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Live chat server listening on :${PORT}`);
});
