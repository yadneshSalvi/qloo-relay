import type { Category, ExchangeTerms, Item, Member, Work } from "./types";

const work = (id: string, title: string, author: string, category: Category, year: number, tags: string[], description: string, background: string, foreground: string, accent: string, subtitle = ""): Work => ({
  id: `work-${id}`, title, author, category, year, tags, description, subtitle,
  colors: { background, foreground, accent }, mappingStatus: "authored", qlooEntityId: null, dataOrigin: "authored-sample",
});

/** Factual titles with original descriptions and original typographic cover colors. No cover art. */
export const CATALOG: Work[] = [
  work("creative-act", "The Creative Act", "Rick Rubin", "book", 2023, ["creativity", "attention", "making", "contemplative"], "A quiet invitation to notice more, trust the process, and make space for a creative life.", "#e8dfcd", "#24352c", "#b53d36", "A Way of Being"),
  work("kind-of-blue", "Kind of Blue", "Miles Davis", "record", 1959, ["jazz", "improvisation", "contemplative", "warm"], "An unhurried jazz landmark built around space, listening, and possibility.", "#173b50", "#eee8d9", "#e9ae56", "Stereo LP · modal jazz"),
  work("hades", "Hades", "Supergiant Games", "game", 2020, ["myth", "craft", "discovery", "replayable"], "Escape the underworld through quick runs, vivid characters, and another chance to begin.", "#9d332b", "#fff2d4", "#d9ee86", "Nintendo Switch"),
  work("dispossessed", "The Dispossessed", "Ursula K. Le Guin", "book", 1974, ["speculative", "society", "discovery", "ideas"], "Two worlds and one physicist question what freedom, belonging, and a better society can mean.", "#c9d7a7", "#233e35", "#dc6242", "An Ambiguous Utopia"),
  work("braiding-sweetgrass", "Braiding Sweetgrass", "Robin Wall Kimmerer", "book", 2013, ["nature", "attention", "reciprocity", "contemplative"], "Stories of plants, reciprocity, and learning to pay careful attention to the living world.", "#355844", "#f4efd9", "#d1d897", "Indigenous Wisdom, Scientific Knowledge"),
  work("journey", "Journey", "thatgamecompany", "game", 2012, ["contemplative", "discovery", "connection", "visual"], "A wordless journey over sand and ruins, where a fleeting companion can change the experience.", "#d99261", "#382d2a", "#f7dfb6", "PlayStation 4"),
  work("blue-train", "Blue Train", "John Coltrane", "record", 1958, ["jazz", "improvisation", "warm", "craft"], "Bright ensemble lines and searching solos, with room for every player to speak.", "#244e74", "#e6efd8", "#87b4b9", "Stereo LP · hard bop"),
  work("earthsea", "A Wizard of Earthsea", "Ursula K. Le Guin", "book", 1968, ["myth", "speculative", "nature", "discovery"], "A young wizard learns that knowing the world begins with knowing the limits of his own power.", "#d0a146", "#293d39", "#ece3b6", "The Earthsea Cycle · Book One"),
  work("invisible-cities", "Invisible Cities", "Italo Calvino", "book", 1972, ["cities", "ideas", "visual", "discovery"], "Imagined cities become small, luminous questions about memory, desire, and the places we inhabit.", "#e1b2a0", "#492e3d", "#753f46", "Translated by William Weaver"),
  work("celeste", "Celeste", "Maddy Makes Games", "game", 2018, ["craft", "attention", "replayable", "connection"], "A precise mountain climb that pairs difficult jumps with a generous story about persistence.", "#7a9ab3", "#f1e9d5", "#eab7ac", "Nintendo Switch"),
  work("discovery", "Discovery", "Daft Punk", "record", 2001, ["electronic", "playful", "making", "warm"], "A joyful electronic record that turns fragments of memory into something bright and new.", "#292c38", "#e9e5d9", "#c5b1ed", "Double LP · electronic"),
  work("nurture", "Nurture", "Porter Robinson", "record", 2021, ["electronic", "nature", "creativity", "contemplative"], "Piano, soft electronics, and outdoor textures trace a creative practice coming back to life.", "#d2dfbf", "#374d3f", "#7e9fa8", "Double LP · electronic"),
  work("slay-the-spire", "Slay the Spire", "Mega Crit", "game", 2019, ["strategy", "replayable", "discovery", "craft"], "Build a deck, adapt to surprises, and find an unlikely route through a shifting tower.", "#5e566e", "#f3e6c7", "#cbb26f", "Nintendo Switch"),
  work("piranesi", "Piranesi", "Susanna Clarke", "book", 2020, ["myth", "contemplative", "visual", "discovery"], "An immense house, tides, and careful notebooks frame a story of wonder and recovering a life.", "#eadcc1", "#41575c", "#8baca3", "A novel"),
  work("selected-ambient-works", "Selected Ambient Works 85–92", "Aphex Twin", "record", 1992, ["electronic", "contemplative", "making", "attention"], "Hushed melodies and restless rhythms make a landscape for getting lost in thought.", "#e6e6dd", "#292f30", "#9da89b", "Double LP · ambient techno"),
  work("stardew-valley", "Stardew Valley", "ConcernedApe", "game", 2016, ["nature", "making", "connection", "playful"], "Make a small farm your own while finding a rhythm within a lively, changing town.", "#597852", "#fff0c5", "#dab16c", "Nintendo Switch"),
  work("ways-of-seeing", "Ways of Seeing", "John Berger", "book", 1972, ["visual", "attention", "ideas", "creativity"], "A compact set of provocations about images, ownership, and how we learn to look.", "#f0e7d2", "#292f2b", "#d1513c", "Essays on looking"),
  work("in-rainbows", "In Rainbows", "Radiohead", "record", 2007, ["warm", "experimental", "attention", "connection"], "Interlocking rhythms and intimate songs reward a close, unhurried listen.", "#ce6d3e", "#2b3437", "#e6bc68", "LP · alternative"),
];

export const MEMBERS: Member[] = [
  { id: "you", name: "You", initials: "YO", bio: "A curious shelf, ready for its next chapter.", color: "#164c37", role: "member", isYou: true, dataOrigin: "authored-sample" },
  { id: "maya", name: "Maya", initials: "MA", bio: "Speculative worlds. Better questions.", color: "#a9573c", role: "member", isYou: false, dataOrigin: "authored-sample" },
  { id: "noah", name: "Noah", initials: "NO", bio: "Games with a story worth sharing.", color: "#657986", role: "member", isYou: false, dataOrigin: "authored-sample" },
  { id: "leila", name: "Leila", initials: "LE", bio: "Long walks, slow reading, small discoveries.", color: "#867048", role: "member", isYou: false, dataOrigin: "authored-sample" },
  { id: "eli", name: "Eli", initials: "EL", bio: "Usually listening to the B-side.", color: "#666b92", role: "member", isYou: false, dataOrigin: "authored-sample" },
  { id: "iris", name: "Iris", initials: "IR", bio: "Architecture, imaginary places, and good music.", color: "#9d6e80", role: "member", isYou: false, dataOrigin: "authored-sample" },
  { id: "jo", name: "Jo", initials: "JO", bio: "Your fictional handoff coordinator at the Reading Room.", color: "#626d51", role: "coordinator", isYou: false, dataOrigin: "authored-sample" },
];

export const TERMS: Omit<ExchangeTerms, "hash"> = {
  version: "relay-hub-v1",
  hubName: "The Reading Room",
  location: "Cedar Commons · ground-floor exchange desk",
  handoffWindow: "Saturday, 5–7 pm · sample handoff window",
  rules: [
    "Exchange the exact copies shown, with the edition and condition you reviewed.",
    "Every member must confirm this complete exchange before any item is reserved.",
    "Bring every item to Jo at the exchange desk. Nothing is released until the whole set passes inspection.",
    "You may withdraw. A changed exchange needs fresh confirmation from every affected member.",
  ],
};

type SeedItem = Pick<Item, "id" | "workId" | "ownerId" | "edition" | "condition" | "notes">;
export const SEED_ITEMS: SeedItem[] = [
  { id: "item-creative-act-you", workId: "work-creative-act", ownerId: "you", edition: "2023 hardcover · English", condition: "like-new", notes: "Read once. Clean pages; ready for another creative shelf." },
  { id: "item-kind-of-blue-you", workId: "work-kind-of-blue", ownerId: "you", edition: "180 g stereo LP · 2015 reissue", condition: "good", notes: "A well-loved listening copy. Sleeve has light corner wear." },
  { id: "item-dispossessed-maya", workId: "work-dispossessed", ownerId: "maya", edition: "Paperback · English", condition: "good", notes: "No annotations. A small crease on the spine." },
  { id: "item-piranesi-maya", workId: "work-piranesi", ownerId: "maya", edition: "2020 hardcover · English", condition: "like-new", notes: "Jacket intact, no marks." },
  { id: "item-hades-noah", workId: "work-hades", ownerId: "noah", edition: "Nintendo Switch · physical cartridge", condition: "like-new", notes: "Original case and cartridge. Finished the story; your turn." },
  { id: "item-celeste-noah", workId: "work-celeste", ownerId: "noah", edition: "Nintendo Switch · physical cartridge", condition: "good", notes: "Cartridge tested. Original case included." },
  { id: "item-slay-the-spire-noah", workId: "work-slay-the-spire", ownerId: "noah", edition: "Nintendo Switch · physical cartridge", condition: "good", notes: "Case and cartridge, with light shelf wear." },
  { id: "item-braiding-sweetgrass-leila", workId: "work-braiding-sweetgrass", ownerId: "leila", edition: "Paperback · English", condition: "good", notes: "One folded page, otherwise clean." },
  { id: "item-journey-leila", workId: "work-journey", ownerId: "leila", edition: "Journey Collector's Edition · PlayStation 4 disc", condition: "good", notes: "Disc tested; includes original case." },
  { id: "item-stardew-valley-leila", workId: "work-stardew-valley", ownerId: "leila", edition: "Nintendo Switch · physical cartridge", condition: "like-new", notes: "A new farm is waiting. Case included." },
  { id: "item-blue-train-eli", workId: "work-blue-train", ownerId: "eli", edition: "Stereo LP · Blue Note reissue", condition: "good", notes: "Plays cleanly. Light sleeve wear." },
  { id: "item-discovery-eli", workId: "work-discovery", ownerId: "eli", edition: "Double LP · 2021 reissue", condition: "like-new", notes: "Both records and sleeves are clean." },
  { id: "item-in-rainbows-eli", workId: "work-in-rainbows", ownerId: "eli", edition: "LP · standard pressing", condition: "good", notes: "A gentle crackle at the lead-in; music plays clearly." },
  { id: "item-invisible-cities-iris", workId: "work-invisible-cities", ownerId: "iris", edition: "Paperback · English translation", condition: "good", notes: "A name written inside the cover, no other marks." },
  { id: "item-nurture-iris", workId: "work-nurture", ownerId: "iris", edition: "Double LP · standard pressing", condition: "like-new", notes: "Carefully stored in inner sleeves." },
  { id: "item-ways-of-seeing-iris", workId: "work-ways-of-seeing", ownerId: "iris", edition: "Penguin paperback · English", condition: "fair", notes: "A few pencil notes. All pages intact." },
];

export const SEED_APPROVALS = [
  { memberId: "noah", giveItemId: "item-hades-noah", receiveItemId: "item-dispossessed-maya", preferenceRank: 1 },
  { memberId: "maya", giveItemId: "item-dispossessed-maya", receiveItemId: "item-creative-act-you", preferenceRank: 1 },
  // Explicitly authored alternative: withdrawing Maya leaves a repairable two-member exchange.
  { memberId: "noah", giveItemId: "item-hades-noah", receiveItemId: "item-creative-act-you", preferenceRank: 2 },
  { memberId: "leila", giveItemId: "item-journey-leila", receiveItemId: "item-dispossessed-maya", preferenceRank: 1 },
  { memberId: "leila", giveItemId: "item-braiding-sweetgrass-leila", receiveItemId: "item-kind-of-blue-you", preferenceRank: 2 },
  { memberId: "eli", giveItemId: "item-blue-train-eli", receiveItemId: "item-braiding-sweetgrass-leila", preferenceRank: 1 },
  { memberId: "iris", giveItemId: "item-invisible-cities-iris", receiveItemId: "item-blue-train-eli", preferenceRank: 1 },
];
