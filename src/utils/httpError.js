// creates an Error that carries an HTTP status code so controllers can answer correctly
const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

module.exports = httpError;
