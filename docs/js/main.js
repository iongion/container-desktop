// Select the button
const btn = document
  .querySelector("link[rel=import][href='../index.html']")
  .import.querySelector(".toggle");
// Select the stylesheet <link>
const theme = document
  .querySelector("link[rel=import][href='../index.html']")
  .import.querySelector("#theme-link");

// Listen for a click on the button
btn.addEventListener("click", function () {
  // If the current URL contains "dark-theme.css"
  if (theme.getAttribute("href") == "../css/dark-theme.css") {
    // ... then switch it to "light-theme.css"
    theme.href = "../css/light-theme.css";
    // Otherwise...
  } else {
    // ... switch it to "dark-theme.css"
    theme.href = "../css/dark-theme.css";
  }
});
