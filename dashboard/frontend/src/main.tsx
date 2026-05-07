import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Set document.title from the bridge's brand env (JANUS_BRAND). The static
// index.html title is just a fallback for the moment before this resolves.
fetch("/api/brand")
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d?.brand) document.title = d.brand; })
  .catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
