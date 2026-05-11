"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
const port = Number(process.env.API_PORT ?? 3001);
app.listen(port, () => {
    console.log(`api listening on http://localhost:${port}`);
});
