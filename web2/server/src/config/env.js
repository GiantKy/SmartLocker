const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../../.env") });

module.exports = {
    PORT: process.env.PORT || 3001
};
