import EnglishResource from "./resources/en.json";

// English is the only shipped language. Every other locale is removed, so
// there is nothing to load or switch between.
export default {
  en: {
    translation: EnglishResource,
  },
};
