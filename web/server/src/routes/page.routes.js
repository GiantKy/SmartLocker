const express = require("express");
const path = require("path");

const { clientPath } = require("../config/paths");

const router = express.Router();

let currentPage = "home";

function resetPageToHome() {
    currentPage = "home";
    try {
        const orderService = require("../services/order.service");
        orderService.clearPendingOrder();
    } catch (e) {}
}

// Hủy giao dịch: reset trạng thái trang về home/index và server redirect về trang chủ
router.all("/api/transaction/cancel", (req, res) => {
    resetPageToHome();
    res.redirect(303, "/");
});

function PageRouting(req, res) {
    const pageRequest = req.path;
    let page = "index";

    if (pageRequest === "/cancel") {
        currentPage = "home";
        page = "index";
    } else if (pageRequest === "/kyc") {
        currentPage = "kyc";
        page = "kyc";
    } else if (pageRequest === "/locker") {
        currentPage = "locker";
        page = "locker";
    } else if (pageRequest === "/send") {
        currentPage = "send";
        page = "send";
    } else if (pageRequest === "/receive") {
        currentPage = "receive";
        page = "receive";
    } else if (pageRequest === "/" || pageRequest === "/index") {
        currentPage = "home";
        page = "index";
    } else if (currentPage === "send" || currentPage === "receive" || currentPage === "kyc" || currentPage === "locker") {
        page = currentPage;
    }

    currentPage = page === "index" ? "home" : page;

    res.sendFile(
        path.join(clientPath, `${page}.html`)
    );
}

router.get("/{*splat}", PageRouting);

module.exports = router;
module.exports.resetPageToHome = resetPageToHome;