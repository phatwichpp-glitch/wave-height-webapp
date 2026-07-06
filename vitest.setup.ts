import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Without `test.globals: true`, @testing-library/react's automatic
// afterEach(cleanup) detection doesn't fire, so unmount rendered components
// explicitly between tests (otherwise DOM from one test leaks into the next).
afterEach(() => {
  cleanup();
});
