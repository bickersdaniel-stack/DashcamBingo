// Bits of the top bar every page shares
// Cards says how many skins you've rolled since you last opened it, like "Cards (+3)"
export function showNewSkins(count) {
    const link = document.querySelector('.bar-nav a[href="/cards"]');
    if (!link) return;
    let badge = link.querySelector(".nav-new");
    if (!badge) link.append(badge = Object.assign(document.createElement("span"), { className: "nav-new" }));
    badge.textContent = count ? ` (+${count})` : "";
}

export const coinsText = n => n === 1 ? "🪙 1 coin" : `🪙 ${n.toLocaleString()} coins`;
export const winsText = n => n === 1 ? "🏆 1 win" : `🏆 ${n.toLocaleString()} wins`;
export const signedInWith = id => `Signed in with ${id.startsWith("google:") ? "Google" : id.startsWith("email:") ? "an email link" : "Discord"}`;
