import { createRoot } from "react-dom/client";
import App from "./App";

const container = document.getElementById("root");
if (container === null) throw new Error("missing #root");

createRoot(container).render(<App />);
