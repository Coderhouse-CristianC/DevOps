const express = require("express");
const uppercase = require("@stdlib/string-uppercase");
const pkg = require("@stdlib/string-uppercase/package.json");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    const text = req.query.text || "hello world";
    res.json({
        original: text,
        uppercase: uppercase(text),
        source: pkg.version === "0.3.1" ? "npm" : "local",
        package_version: pkg.version,
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
