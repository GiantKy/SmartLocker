const path = require("path");

const clientPath = path.join(__dirname, "../../../client/");
const clientAssetsPath = path.join(clientPath, "assets/");
const uploadsPath = path.join(__dirname, "../../uploads/");

module.exports = {
    clientPath,
    clientAssetsPath,
    uploadsPath
};