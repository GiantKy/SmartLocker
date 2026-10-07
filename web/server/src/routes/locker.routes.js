const express = require("express");
const router = express.Router();
const lockerController = require("../controllers/locker.controller");

router.get("/check", lockerController.checkAvailable);

module.exports = router;
