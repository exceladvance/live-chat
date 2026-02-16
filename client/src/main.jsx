import React from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./styles.css";

const NAME_KEY = "liveSessionName";
const NAME_EXP_KEY = "liveSessionNameExpiresAt";
const SESSION_KEY = "liveSessionSessionId";
const VOTER_KEY = "liveSessionVoterKey";
const POLL_VOTES_KEY = "liveSessionPollVotes";
const NAME_TTL_MS = 10 * 60 * 60 * 1000;

function getOrCreateSessionId() {
  const existing = sessionStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const value = `session_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(SESSION_KEY, value);
  return value;
}

function loadName() {
  const sessionId = getOrCreateSessionId();
  const raw = localStorage.getItem(NAME_KEY);
  const expiresAt = Number(localStorage.getItem(NAME_EXP_KEY) || 0);

  if (!raw || !expiresAt || Date.now() > expiresAt) {
    return "";
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.sessionId !== sessionId || !parsed?.name) {
      return "";
    }
    return parsed.name;
  } catch {
    return "";
  }
}

function saveName(name) {
  localStorage.setItem(
    NAME_KEY,
    JSON.stringify({
      sessionId: getOrCreateSessionId(),
      name
    })
  );
  localStorage.setItem(NAME_EXP_KEY, String(Date.now() + NAME_TTL_MS));
}

function getVoterKey() {
  const existing = localStorage.getItem(VOTER_KEY);
  if (existing) return existing;
  const value = `voter_${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(VOTER_KEY, value);
  return value;
}

function loadPollVotes() {
  try {
    return JSON.parse(localStorage.getItem(POLL_VOTES_KEY) || "{}");
  } catch {
    return {};
  }
}

function App() {
  const [name, setName] = React.useState(loadName);
  const [draftName, setDraftName] = React.useState("");
  const [changingName, setChangingName] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [messages, setMessages] = React.useState([]);
  const [polls, setPolls] = React.useState([]);
  const [messageText, setMessageText] = React.useState("");
  const [tab, setTab] = React.useState("chat");
  const [error, setError] = React.useState("");
  const [pollVotes, setPollVotes] = React.useState(loadPollVotes);
  const [question, setQuestion] = React.useState("");
  const [options, setOptions] = React.useState(["", ""]);

  const messageListRef = React.useRef(null);
  const socketRef = React.useRef(null);
  const moderator = new URLSearchParams(window.location.search).get("moderator") === "true";

  React.useEffect(() => {
    localStorage.setItem(POLL_VOTES_KEY, JSON.stringify(pollVotes));
  }, [pollVotes]);

  React.useEffect(() => {
    if (!name) return undefined;

    const socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:4000", {
      transports: ["websocket"],
      reconnection: true,
      auth: { name, moderator }
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("session:init", (payload) => {
      setMessages(payload.messages || []);
      setPolls(payload.polls || []);
    });

    socket.on("chat:new", (message) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on("poll:new", (poll) => {
      setPolls((prev) => [poll, ...prev]);
      setTab("polls");
    });

    socket.on("poll:update", (poll) => {
      setPolls((prev) => prev.map((item) => (item.pollId === poll.pollId ? poll : item)));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [name, moderator]);

  React.useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const join = () => {
    const trimmed = draftName.trim().slice(0, 60);
    if (!trimmed) return;
    saveName(trimmed);
    setName(trimmed);
    setDraftName("");
    setChangingName(false);
  };

  const sendMessage = () => {
    const text = messageText.trim().slice(0, 500);
    if (!text || !socketRef.current) return;

    socketRef.current.emit("chat:send", { messageText: text }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "Unable to send.");
        return;
      }
      setError("");
      setMessageText("");
    });
  };

  const submitPoll = (event) => {
    event.preventDefault();
    const socket = socketRef.current;
    if (!socket) return;

    const payload = {
      question,
      options
    };

    socket.emit("poll:create", payload, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "Could not create poll.");
        return;
      }

      setError("");
      setQuestion("");
      setOptions(["", ""]);
    });
  };

  const vote = (pollId, optionId) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("poll:vote", { pollId, optionId, voterKey: getVoterKey() }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "Vote failed.");
        return;
      }

      setPollVotes((prev) => ({
        ...prev,
        [pollId]: optionId
      }));
      setError("");
    });
  };

  const closePoll = (pollId) => {
    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("poll:close", { pollId }, (ack) => {
      if (!ack?.ok) {
        setError(ack?.error || "Could not close poll.");
      }
    });
  };

  if (!name || changingName) {
    return (
      <div className="join-overlay">
        <div className="join-modal">
          <h1>Enter your name</h1>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && join()}
            placeholder="Your name"
            maxLength={60}
            autoFocus
          />
          <button onClick={join} disabled={!draftName.trim()}>
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>Live Session</h1>
          <span className={connected ? "badge connected" : "badge"}>{connected ? "Connected" : "Reconnecting"}</span>
        </div>
        <div className="header-actions">
          {moderator && <span className="moderator-pill">Moderator Mode</span>}
          <button className="link-btn" onClick={() => setChangingName(true)}>
            Change Name
          </button>
        </div>
      </header>

      <div className="tabs">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Chat</button>
        <button className={tab === "polls" ? "active" : ""} onClick={() => setTab("polls")}>Polls</button>
      </div>

      {error && <p className="error">{error}</p>}

      {tab === "chat" && (
        <section className="chat-panel">
          <div className="message-list" ref={messageListRef}>
            {messages.map((message) => (
              <article key={message.id} className="message-card">
                <p>
                  <strong>{message.senderName}:</strong> {message.messageText}
                </p>
                <small>{new Date(message.timestamp).toLocaleTimeString()}</small>
                {moderator && (
                  <button
                    className="copy-btn"
                    onClick={() => navigator.clipboard?.writeText(`${message.senderName}: ${message.messageText}`)}
                  >
                    Copy
                  </button>
                )}
              </article>
            ))}
          </div>

          <div className="composer">
            <input
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              maxLength={500}
              placeholder="Send a message"
              onKeyDown={(event) => event.key === "Enter" && sendMessage()}
            />
            <button onClick={sendMessage} disabled={!messageText.trim()}>
              Send
            </button>
          </div>
        </section>
      )}

      {tab === "polls" && (
        <section className="polls-panel">
          {moderator && (
            <form className="poll-form" onSubmit={submitPoll}>
              <h3>Create Poll</h3>
              <input
                placeholder="Question"
                value={question}
                onChange={(event) => setQuestion(event.target.value.slice(0, 200))}
                maxLength={200}
                required
              />
              {options.map((option, index) => (
                <input
                  key={index}
                  placeholder={`Option ${index + 1}`}
                  value={option}
                  onChange={(event) => {
                    const next = [...options];
                    next[index] = event.target.value.slice(0, 80);
                    setOptions(next);
                  }}
                  maxLength={80}
                  required={index < 2}
                />
              ))}
              <div className="poll-form-actions">
                <button
                  type="button"
                  disabled={options.length >= 6}
                  onClick={() => setOptions((prev) => [...prev, ""])}
                >
                  Add Option
                </button>
                <button type="button" disabled={options.length <= 2} onClick={() => setOptions((prev) => prev.slice(0, -1))}>
                  Remove Option
                </button>
                <button type="submit">Create Poll</button>
              </div>
            </form>
          )}

          <div className="poll-list">
            {polls.map((poll) => {
              const votedOption = pollVotes[poll.pollId];

              return (
                <article key={poll.pollId} className="poll-card">
                  <div className="poll-head">
                    <h4>{poll.question}</h4>
                    <span className={poll.status === "active" ? "status active" : "status"}>
                      {poll.status === "active" ? "Active" : "Closed"}
                    </span>
                  </div>
                  <p className="meta">
                    Created by {poll.createdBy} · {new Date(poll.createdAt).toLocaleTimeString()} · {poll.totalVotes} votes
                  </p>

                  {poll.options.map((option) => {
                    const pct = poll.totalVotes ? Math.round((option.votesCount / poll.totalVotes) * 100) : 0;
                    const isVoted = votedOption === option.id;
                    return (
                      <div key={option.id} className="option-row">
                        <button
                          disabled={poll.status !== "active"}
                          className={isVoted ? "voted" : ""}
                          onClick={() => vote(poll.pollId, option.id)}
                        >
                          {option.text} {isVoted ? "(Update vote)" : ""}
                        </button>
                        <div className="result-line">
                          <span>
                            {option.votesCount} votes · {pct}%
                          </span>
                          <div className="progress">
                            <div style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {moderator && poll.status === "active" && (
                    <button className="close-btn" onClick={() => closePoll(poll.pollId)}>
                      Close Poll
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
