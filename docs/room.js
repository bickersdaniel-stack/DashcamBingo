// Together mode: Discord sign-in for now; rooms come next
import "./core.js";

const me = await fetch("/api/me").then(response => response.ok ? response.json() : null);
document.getElementById(me ? "signedIn" : "signedOut").hidden = false;

if (me) {
    document.getElementById("account").hidden = false;
    document.querySelectorAll(".my-avatar").forEach(img => img.src = me.avatar);
    document.querySelectorAll(".my-name").forEach(el => el.textContent = me.name); // textContent: names are untrusted
}
