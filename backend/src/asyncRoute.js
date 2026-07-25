// Express 4 has no idea what to do with a handler that returns a rejected
// promise: the rejection goes unhandled and the request hangs until the
// client times out, with no response and no log line.
//
// That was survivable when every store call was a synchronous file write.
// With a database behind the store, a dropped connection or a statement
// timeout is an ordinary runtime event, so every async handler is wrapped
// and its failures forwarded to the error middleware in server.js.
export const route = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
