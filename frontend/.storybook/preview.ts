import type { Preview } from "@storybook/react";
import "../src/styles.css";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i } },
    backgrounds: {
      default: "deep-sea",
      values: [{ name: "deep-sea", value: "#10132b" }],
    },
  },
};

export default preview;
