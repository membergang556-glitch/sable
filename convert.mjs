import sharp from "sharp";
await sharp("web/public/og.svg").resize(1200, 630).png().toFile("web/public/og.png");
console.log("ok");
