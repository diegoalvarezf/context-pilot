// node:sqlite prints an ExperimentalWarning on load; hide only that one.
const defaultListeners = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && /SQLite/i.test(warning.message)) return;
  for (const listener of defaultListeners) listener(warning);
});
