import AppLite from "./AppLite";
import AppFull from "./AppFull";

const EDITION = import.meta.env.VITE_EDITION;

export default function App() {
  return EDITION === "full" ? <AppFull /> : <AppLite />;
}
