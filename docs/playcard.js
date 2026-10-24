// The playing card a square opens as, shared by the room's details pop-up and the shop: name, art in its pack's
// colour (or its skin's look), the rules, and the pack and how often it's spotted. Abilities will fit in here one day
const hueOf = id => [...id].reduce((hue, letter) => (hue * 31 + letter.charCodeAt(0)) % 360, 200);

function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// The skin classes (skin-<style>, rarity-<rarity>) a card or square wears
export function wearSkin(node, skin) {
    node.classList.remove(...[...node.classList].filter(name => name.startsWith("skin-") || name.startsWith("rarity-")));
    node.classList.toggle("skinned", !!skin);
    if (skin) node.classList.add(`skin-${skin.id}`, `rarity-${skin.rarity}`);
}

export function fillPlayCard(node, { name, count = 0, note = "", packId = "", packName = "", rate = null, skin = null }) {
    node.style.setProperty("--pack-hue", hueOf(packId));
    wearSkin(node, skin);
    const head = el("span", "play-card-head");
    head.append(el("strong", "play-card-name", name));
    if (count) head.append(el("span", "play-card-count", `×${count}`));
    if (skin) head.append(Object.assign(el("span", "play-card-gem"), { title: skin.rarity }));
    const foot = el("span", "play-card-foot");
    foot.append(el("span", "", skin ? `${packName} · ${skin.name}` : packName), el("span", "", rate == null ? "New card" : `Spotted ${rate}%`));
    node.replaceChildren(head, el("span", "play-card-art"), el("span", "play-card-text", note || "No special rules. If you see it, count it."), foot);
}
