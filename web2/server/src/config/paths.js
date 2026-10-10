const path = require("path");

const clientPath = path.join(__dirname, "../../../client/");
const clientAssetsPath = path.join(clientPath, "assets/");

module.exports = {
    clientPath,
    clientAssetsPath
};
