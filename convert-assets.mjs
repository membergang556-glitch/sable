import sharp from "sharp";

await sharp("web/public/og.svg").resize(1200, 630).png().toFile("web/public/og.png");
console.log("og.png ok");

await sharp("web/public/banner.svg").resize(1500, 500).png().toFile("web/public/banner.png");
console.log("banner.png ok");
