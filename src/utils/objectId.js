// strict MongoDB ObjectId check (24 hex chars) – mongoose.isValidObjectId also accepts any 12-char string
const isObjectId = (value) => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

module.exports = { isObjectId };
