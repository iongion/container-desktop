const path = require("path");

module.exports = {
  plugins: ["react", "@typescript-eslint", "import", "prettier"],
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "plugin:import/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:prettier/recommended"
  ],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      extends: ["plugin:@typescript-eslint/recommended", "plugin:import/typescript"],
      rules: {
        "@typescript-eslint/no-empty-object-type": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/ban-types": "off"
      }
    },

    {
      files: ["**/*.js?(x)"],
      rules: {
        "react/prop-types": "off",
        "import/default": "off",
        "no-unused-vars": "off"
      }
    }
  ],
  ignorePatterns: ["node_modules", "dist", "build"],
  rules: {
    "prettier/prettier": "error",
    "import/no-unresolved": "error",
    "import/no-named-as-default": "off",
    "import/no-named-as-default-member": "off",
    "jsx-a11y/media-has-caption": "off",
    "jsx-a11y/click-events-have-key-events": "off",
    "jsx-a11y/no-static-element-interactions": "off",
    "no-prototype-builtins": "off",
    "no-unused-vars": "off"
  },
  settings: {
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx", ".mts"]
    },
    "import/resolver": {
      typescript: true,
      node: true,
      alias: {
        map: [["@", path.resolve(__dirname, "./src")]],
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"]
      }
    },
    react: {
      version: "detect"
    }
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 12,
    sourceType: "module"
  },
  env: {
    browser: true,
    node: true,
    jest: true,
    es2020: true
  }
};
