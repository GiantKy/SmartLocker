tailwind.config = {
    darkMode: "class",

    theme: {
        extend: {
            colors: {
                "surface-container-highest": "#d3e4fe",
                "surface-bright": "#f8f9ff",
                "on-surface-variant": "#45464e",
                "on-error-container": "#93000a",
                "on-secondary": "#ffffff",
                "on-error": "#ffffff",
                "on-tertiary-container": "#209c90",
                "outline": "#75777f",
                "tertiary-fixed": "#89f5e7",
                "surface-dim": "#cbdbf5",
                "surface-tint": "#4e5d86",
                "on-primary-fixed-variant": "#36466d",
                "outline-variant": "#c5c6cf",
                "tertiary-container": "#002a26",
                "error": "#ba1a1a",
                "secondary-fixed-dim": "#ffb596",
                "on-tertiary": "#ffffff",
                "surface-container": "#e5eeff",
                "on-primary-fixed": "#071a3f",
                "on-secondary-fixed": "#360f00",
                "inverse-surface": "#213145",
                "background": "#f8f9ff",
                "tertiary-fixed-dim": "#6bd8cb",
                "surface-container-lowest": "#ffffff",
                "secondary-fixed": "#ffdbcd",
                "primary-fixed": "#dae2ff",
                "inverse-primary": "#b6c6f4",
                "on-surface": "#0b1c30",
                "on-tertiary-fixed": "#00201d",
                "on-primary-container": "#7b8bb6",
                "on-tertiary-fixed-variant": "#005049",
                "surface": "#f8f9ff",
                "primary-container": "#122348",
                "on-secondary-container": "#551c00",
                "on-background": "#0b1c30",
                "primary": "#000d2d",
                "on-primary": "#ffffff",
                "error-container": "#ffdad6",
                "surface-variant": "#d3e4fe",
                "tertiary": "#001210",
                "secondary": "#a33e00",
                "surface-container-high": "#dce9ff",
                "on-secondary-fixed-variant": "#7c2d00",
                "inverse-on-surface": "#eaf1ff",
                "secondary-container": "#fd6607"
            },

            borderRadius: {
                DEFAULT: "0.25rem",
                lg: "0.5rem",
                xl: "0.75rem",
                full: "9999px"
            },

            spacing: {
                "space-xs": "0.25rem",
                "space-md": "1rem",
                "space-lg": "1.5rem",
                gutter: "1rem",
                "space-sm": "0.5rem",
                margin: "1rem",
                "space-xl": "2rem"
            },

            fontFamily: {
                "headline-md": ["Be Vietnam Pro"],
                "headline-lg-mobile": ["Be Vietnam Pro"],
                "display-lg-mobile": ["Be Vietnam Pro"],
                "label-sm": ["Be Vietnam Pro"],
                "body-lg": ["Be Vietnam Pro"],
                "display-lg": ["Be Vietnam Pro"],
                "headline-lg": ["Be Vietnam Pro"],
                "headline-sm": ["Be Vietnam Pro"],
                "label-md": ["Be Vietnam Pro"],
                "label-lg": ["Be Vietnam Pro"],
                "body-md": ["Be Vietnam Pro"],
                "body-sm": ["Be Vietnam Pro"]
            },

            fontSize: {
                "headline-md": [
                    "20px",
                    {
                        lineHeight: "28px",
                        fontWeight: "600"
                    }
                ],

                "headline-lg-mobile": [
                    "24px",
                    {
                        lineHeight: "32px",
                        fontWeight: "600"
                    }
                ],

                "display-lg-mobile": [
                    "28px",
                    {
                        lineHeight: "36px",
                        fontWeight: "700"
                    }
                ],

                "label-sm": [
                    "11px",
                    {
                        lineHeight: "14px",
                        fontWeight: "600"
                    }
                ],

                "body-lg": [
                    "16px",
                    {
                        lineHeight: "24px",
                        fontWeight: "400"
                    }
                ],

                "display-lg": [
                    "36px",
                    {
                        lineHeight: "44px",
                        fontWeight: "700"
                    }
                ],

                "headline-lg": [
                    "30px",
                    {
                        lineHeight: "38px",
                        fontWeight: "600"
                    }
                ],

                "headline-sm": [
                    "18px",
                    {
                        lineHeight: "24px",
                        fontWeight: "600"
                    }
                ],

                "label-md": [
                    "14px",
                    {
                        lineHeight: "18px",
                        fontWeight: "500"
                    }
                ],

                "label-lg": [
                    "16px",
                    {
                        lineHeight: "20px",
                        fontWeight: "600"
                    }
                ],

                "body-md": [
                    "14px",
                    {
                        lineHeight: "20px",
                        fontWeight: "400"
                    }
                ],

                "body-sm": [
                    "12px",
                    {
                        lineHeight: "16px",
                        fontWeight: "400"
                    }
                ]
            }
        }
    }
};

/**
 * Hệ thống Popup Thông Báo dùng chung
 * Tự động khởi tạo DOM nếu trang chưa có và hỗ trợ cuộn khi nội dung dài.
 */
const AppPopup = {
    elementId: "shared-app-popup",
    closeTimer: null,

    ensureMounted() {
        let popupEl = document.getElementById(this.elementId);
        if (popupEl) {
            return popupEl;
        }

        popupEl = document.createElement("div");
        popupEl.id = this.elementId;
        popupEl.setAttribute("role", "dialog");
        popupEl.setAttribute("aria-modal", "true");
        popupEl.setAttribute("aria-labelledby", "app-popup-title");
        popupEl.className =
            "app-popup-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/50";

        popupEl.innerHTML = `
            <div class="app-popup-card bg-surface-container-lowest w-full max-w-md max-h-[82vh] rounded-2xl shadow-2xl border border-outline-variant/40 flex flex-col overflow-hidden">
                <!-- Header cố định -->
                <div class="flex items-center justify-between px-5 py-4 border-b border-outline-variant/30 bg-surface shrink-0">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-9 h-9 rounded-xl bg-secondary-fixed flex items-center justify-center text-secondary-container shrink-0">
                            <span id="app-popup-icon" class="material-symbols-outlined text-[22px]">
                                notifications_active
                            </span>
                        </div>
                        <h3 id="app-popup-title" class="font-headline-sm text-headline-sm text-primary font-bold truncate">
                            Thông báo
                        </h3>
                    </div>
                    <button
                        type="button"
                        data-popup-close
                        aria-label="Đóng thông báo"
                        class="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container active:scale-95 transition"
                    >
                        <span class="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                <!-- Nội dung có thanh cuộn khi quá dài -->
                <div id="app-popup-body" class="popup-scroll px-5 py-4 text-body-md text-on-surface space-y-3 flex-1">
                </div>

                <!-- Footer cố định -->
                <div class="px-5 py-3.5 border-t border-outline-variant/30 bg-surface flex items-center gap-3 shrink-0">
                    <button
                        type="button"
                        id="app-popup-cancel"
                        data-popup-close
                        class="hidden flex-1 py-2.5 px-4 rounded-xl bg-surface-container text-primary font-label-lg text-label-md font-semibold hover:bg-surface-container-high active:scale-[0.99] transition"
                    >
                        Quay lại
                    </button>
                    <button
                        type="button"
                        id="app-popup-confirm"
                        class="flex-1 py-2.5 px-5 rounded-xl bg-primary text-on-primary font-label-lg text-label-md font-semibold hover:opacity-95 active:scale-[0.99] transition shadow-sm"
                    >
                        Đã hiểu
                    </button>
                </div>
            </div>
        `;

        // Đóng khi bấm vào vùng nền tối bên ngoài hoặc nút có data-popup-close
        popupEl.addEventListener("click", (event) => {
            if (event.target === popupEl || event.target.closest("[data-popup-close]")) {
                this.close();
            }
        });

        const confirmBtn = popupEl.querySelector("#app-popup-confirm");
        if (confirmBtn) {
            confirmBtn.addEventListener("click", () => {
                if (typeof this.onConfirmCallback === "function") {
                    const cb = this.onConfirmCallback;
                    this.onConfirmCallback = null;
                    cb();
                } else {
                    this.close();
                }
            });
        }

        document.body.appendChild(popupEl);
        return popupEl;
    },

    onConfirmCallback: null,

    show({
        title = "Thông báo",
        content = "",
        icon = "info",
        confirmText = "Đã hiểu",
        cancelText = "",
        onConfirm = null
    } = {}) {
        const popupEl = this.ensureMounted();

        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = null;
        }

        this.onConfirmCallback = onConfirm;

        const titleEl = popupEl.querySelector("#app-popup-title");
        const bodyEl = popupEl.querySelector("#app-popup-body");
        const iconEl = popupEl.querySelector("#app-popup-icon");
        const confirmBtn = popupEl.querySelector("#app-popup-confirm");
        const cancelBtn = popupEl.querySelector("#app-popup-cancel");

        if (titleEl) titleEl.textContent = title;
        if (iconEl) iconEl.textContent = icon;
        if (confirmBtn) confirmBtn.textContent = confirmText;

        if (cancelBtn) {
            if (cancelText) {
                cancelBtn.textContent = cancelText;
                cancelBtn.classList.remove("hidden");
            } else {
                cancelBtn.classList.add("hidden");
            }
        }

        if (bodyEl) {
            bodyEl.innerHTML = content;
            bodyEl.scrollTop = 0;
        }

        popupEl.classList.remove("is-closing");
        void popupEl.offsetWidth;
        requestAnimationFrame(() => {
            popupEl.classList.add("is-open");
        });
        document.body.style.overflow = "hidden";
    },

    close() {
        const popupEl = document.getElementById(this.elementId);
        if (!popupEl || !popupEl.classList.contains("is-open")) return;

        this.onConfirmCallback = null;
        popupEl.classList.remove("is-open");
        popupEl.classList.add("is-closing");
        document.body.style.overflow = "";

        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
        }
        this.closeTimer = setTimeout(() => {
            popupEl.classList.remove("is-closing");
            this.closeTimer = null;
        }, 280);
    }
};

window.AppPopup = AppPopup;
window.showPopup = (title, content, options = {}) => {
    AppPopup.show({ title, content, ...options });
};
window.closePopup = () => {
    AppPopup.close();
};

// Nội dung Hướng dẫn sử dụng
function openUserGuidePopup() {
    const guideHtml = `
        <div class="space-y-4">
            <p class="text-on-surface-variant">
                Chào mừng bạn đến với hệ thống giao nhận thông minh <strong>guinhando.xyz</strong>. Vui lòng xem hướng dẫn chi tiết bên dưới để thực hiện giao dịch nhanh chóng:
            </p>

            <div class="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40 space-y-2">
                <div class="flex items-center gap-2 text-secondary-container font-bold">
                    <span class="material-symbols-outlined text-[20px]">outbox</span>
                    <span>1. Quy trình Gửi Hàng</span>
                </div>
                <ul class="list-disc pl-5 space-y-1.5 text-on-surface-variant text-body-sm">
                    <li><strong>Bước 1:</strong> Nhấn vào nút <strong>GỬI HÀNG</strong> tại màn hình chính.</li>
                    <li><strong>Bước 2:</strong> Nhập đầy đủ thông tin người gửi, người nhận và số điện thoại liên hệ.</li>
                    <li><strong>Bước 3:</strong> Thực hiện xác thực danh tính điện tử (eKYC) nếu được yêu cầu để đảm bảo an toàn bưu kiện.</li>
                    <li><strong>Bước 4:</strong> Kiểm tra lại thông tin đơn hàng, xác nhận tạo đơn và đặt kiện hàng vào tủ hoặc giao cho nhân viên vận chuyển.</li>
                </ul>
            </div>

            <div class="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40 space-y-2">
                <div class="flex items-center gap-2 text-primary font-bold">
                    <span class="material-symbols-outlined text-[20px]">move_to_inbox</span>
                    <span>2. Quy trình Nhận Hàng</span>
                </div>
                <ul class="list-disc pl-5 space-y-1.5 text-on-surface-variant text-body-sm">
                    <li><strong>Bước 1:</strong> Nhấn vào nút <strong>NHẬN HÀNG</strong> tại màn hình chính.</li>
                    <li><strong>Bước 2:</strong> Nhập mã vận đơn hoặc mã OTP nhận hàng được gửi qua tin nhắn/ứng dụng.</li>
                    <li><strong>Bước 3:</strong> Xác nhận thông tin người nhận hoặc quét mã QR tại quầy/tủ thông minh.</li>
                    <li><strong>Bước 4:</strong> Nhận kiện hàng và kiểm tra tình trạng niêm phong trước khi rời đi.</li>
                </ul>
            </div>

            <div class="p-3.5 rounded-xl bg-surface-container/60 border border-outline-variant/40 space-y-2">
                <div class="flex items-center gap-2 text-on-tertiary-fixed-variant font-bold">
                    <span class="material-symbols-outlined text-[20px]">verified_user</span>
                    <span>3. Lưu ý quan trọng</span>
                </div>
                <ul class="list-disc pl-5 space-y-1.5 text-on-surface-variant text-body-sm">
                    <li>Không gửi các mặt hàng cấm, chất dễ cháy nổ hoặc hàng hóa vi phạm quy định pháp luật.</li>
                    <li>Đóng gói kỹ các mặt hàng dễ vỡ và ghi chú rõ ràng bên ngoài kiện hàng.</li>
                    <li>Bảo mật mã OTP/QR nhận hàng, tuyệt đối không chia sẻ cho người lạ.</li>
                    <li>Nếu cần hỗ trợ khẩn cấp, vui lòng liên hệ bộ phận CSKH trực tuyến 24/7.</li>
                </ul>
            </div>
        </div>
    `;

    AppPopup.show({
        title: "Hướng Dẫn Sử Dụng",
        icon: "menu_book",
        content: guideHtml,
        confirmText: "Đã hiểu"
    });
}

window.openUserGuidePopup = openUserGuidePopup;

// Hàm chống XSS khi hiển thị dữ liệu người dùng
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.escapeHtml = escapeHtml;

// Đóng popup bằng phím ESC
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        AppPopup.close();
    }
});

// Tự động khởi tạo DOM popup và gắn sự kiện cho các nút trên trang index
document.addEventListener("DOMContentLoaded", () => {
    AppPopup.ensureMounted();

    const guideBtn = document.getElementById("btn-user-guide");
    if (guideBtn) {
        guideBtn.addEventListener("click", openUserGuidePopup);
    }

    const goSendBtn = document.getElementById("btn-go-send");
    if (goSendBtn) {
        // Đảm bảo nút luôn mở khi quay lại trang chủ (ví dụ bấm Back trên trình duyệt)
        window.addEventListener("pageshow", () => {
            goSendBtn.disabled = false;
            goSendBtn.classList.remove("opacity-60", "pointer-events-none", "cursor-not-allowed");
        });

        goSendBtn.addEventListener("click", async () => {
            // Khóa nút tạm thời để tránh bấm liên tục
            goSendBtn.disabled = true;
            goSendBtn.classList.add("opacity-60", "pointer-events-none", "cursor-not-allowed");

            try {
                // Kiểm tra xem còn khay tủ trống không
                const response = await fetch("/api/lockers/check", { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("Lỗi khi kiểm tra khay tủ");
                }

                const data = await response.json();

                if (data.trong) {
                    // Còn khay trống -> Chuyển tiếp sang trang gửi hàng
                    window.location.href = "send";
                } else {
                    // Hết khay trống -> Hiện thông báo và mở lại nút
                    AppPopup.show({
                        title: "Tủ Đã Hết Khay Trống",
                        icon: "inventory_2",
                        content: `
                            <p class="text-on-surface-variant">
                                Hiện tại tất cả các khay tủ đều đã đầy hoặc đang được sử dụng. Vui lòng quay lại sau!
                            </p>
                        `,
                        confirmText: "Đã hiểu"
                    });

                    goSendBtn.disabled = false;
                    goSendBtn.classList.remove("opacity-60", "pointer-events-none", "cursor-not-allowed");
                }
            } catch (error) {
                console.error("Lỗi kiểm tra tình trạng tủ:", error);
                AppPopup.show({
                    title: "Lỗi Kết Nối",
                    icon: "error",
                    content: `
                        <p class="text-on-surface-variant">
                            Không thể kiểm tra tình trạng tủ lúc này. Vui lòng kiểm tra lại kết nối và thử lại.
                        </p>
                    `,
                    confirmText: "Đã hiểu"
                });

                goSendBtn.disabled = false;
                goSendBtn.classList.remove("opacity-60", "pointer-events-none", "cursor-not-allowed");
            }
        });
    }

    const goReceiveBtn = document.getElementById("btn-go-receive");
    if (goReceiveBtn) {
        goReceiveBtn.addEventListener("click", () => {
            window.location.href = "receive";
        });
    }

    // Xử lý nút Hủy giao dịch (nếu có trên trang)
    const cancelBtn = document.getElementById("btn-cancel-transaction");
    if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
            AppPopup.show({
                title: "Hủy giao dịch",
                icon: "warning",
                content: `
                    <p class="text-on-surface-variant">
                        Bạn có chắc chắn muốn hủy giao dịch hiện tại và quay về trang chủ không?
                    </p>
                `,
                cancelText: "Tiếp tục",
                confirmText: "Hủy giao dịch",
                onConfirm: () => {
                    window.location.href = "/";
                }
            });
        });
    }

    // Xử lý form nhận hàng (receive.html)
    const receiveForm = document.getElementById("receive-order-form");
    if (receiveForm) {
        receiveForm.addEventListener("submit", (event) => {
            event.preventDefault();

            const receivePhone = document.getElementById("receive-phone")?.value.trim() || "";
            const receiveOtp = document.getElementById("receive-otp")?.value.trim() || "";

            if (!receivePhone) {
                AppPopup.show({
                    title: "Thiếu thông tin",
                    icon: "error",
                    content: `
                        <p class="text-on-surface-variant">
                            Vui lòng nhập <strong>SĐT người nhận</strong> trước khi xác nhận.
                        </p>
                    `,
                    confirmText: "Đã hiểu"
                });
                return;
            }

            const phoneRegex = /^(0|\+84)[0-9]{8,10}$/;
            if (!phoneRegex.test(receivePhone.replace(/\s+/g, ""))) {
                AppPopup.show({
                    title: "Số điện thoại chưa hợp lệ",
                    icon: "call_end",
                    content: `
                        <p class="text-on-surface-variant">
                            Vui lòng kiểm tra lại định dạng số điện thoại người nhận (gồm 9-11 chữ số, bắt đầu bằng 0 hoặc +84).
                        </p>
                    `,
                    confirmText: "Kiểm tra lại"
                });
                return;
            }

            if (!receiveOtp) {
                AppPopup.show({
                    title: "Thiếu mã OTP",
                    icon: "pin",
                    content: `
                        <p class="text-on-surface-variant">
                            Vui lòng nhập <strong>Mã OTP nhận hàng</strong> trước khi xác nhận.
                        </p>
                    `,
                    confirmText: "Đã hiểu"
                });
                return;
            }

            if (receiveOtp.length < 4 || receiveOtp.length > 8) {
                AppPopup.show({
                    title: "Mã OTP chưa hợp lệ",
                    icon: "lock_clock",
                    content: `
                        <p class="text-on-surface-variant">
                            Mã OTP nhận hàng thường gồm 4 - 6 chữ số. Vui lòng kiểm tra lại.
                        </p>
                    `,
                    confirmText: "Kiểm tra lại"
                });
                return;
            }

            const confirmReceiveHtml = `
                <div class="space-y-3.5">
                    <p class="text-on-surface-variant text-body-sm">
                        Vui lòng kiểm tra lại thông tin nhận hàng trước khi xác nhận:
                    </p>

                    <div class="p-3.5 rounded-xl bg-surface-container/70 border border-outline-variant/40 space-y-2">
                        <div class="flex items-center gap-2 text-primary font-bold text-label-md uppercase tracking-wide">
                            <span class="material-symbols-outlined text-[18px]">move_to_inbox</span>
                            <span>Thông tin nhận hàng</span>
                        </div>
                        <div class="grid grid-cols-3 gap-1 text-body-sm">
                            <span class="text-on-surface-variant">SĐT người nhận:</span>
                            <span class="col-span-2 font-semibold text-primary">${escapeHtml(receivePhone)}</span>
                        </div>
                        <div class="grid grid-cols-3 gap-1 text-body-sm">
                            <span class="text-on-surface-variant">Mã OTP:</span>
                            <span class="col-span-2 font-mono font-bold text-primary tracking-widest">${escapeHtml(receiveOtp)}</span>
                        </div>
                    </div>
                </div>
            `;

            AppPopup.show({
                title: "Xác Nhận Nhận Hàng",
                icon: "fact_check",
                content: confirmReceiveHtml,
                cancelText: "Chỉnh sửa",
                confirmText: "Đồng ý",
                onConfirm: () => {
                    AppPopup.show({
                        title: "Xác Nhận Thành Công",
                        icon: "check_circle",
                        content: `
                            <p class="text-on-surface-variant">
                                Hệ thống đã xác thực mã OTP và ghi nhận yêu cầu nhận hàng cho số điện thoại <strong>${escapeHtml(receivePhone)}</strong>!
                            </p>
                        `,
                        confirmText: "Về trang chủ",
                        onConfirm: () => {
                            window.location.href = "/";
                        }
                    });
                }
            });
        });
    }
});
