import { createAppStore } from "./domain/store";
import { CURRENT_ENVIRONMENT } from "./Environment";

export const store = createAppStore(CURRENT_ENVIRONMENT);
