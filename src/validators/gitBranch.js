// Git's own branch-name rules (`git check-ref-format --branch`, see
// git-check-ref-format(1)), not a narrower allow-list: a name a push ever
// succeeded with stays valid, so no stored environment becomes uneditable.
// The branch reaches `git checkout -B`, `git push`, the generated workflow's
// trigger and the Argo CD targetRevision (OP-271).
//
// Forbidden anywhere: control characters and DEL, space ~ ^ : ? * [ \, "..",
// "@{" and "//". Also refused: a leading "-" (it would read as an option), a
// leading or trailing "/", a trailing ".", a component that starts with "."
// or ends in ".lock", the single name "@", and "HEAD", which git will not
// create as a branch. 255 characters is git's practical limit (one path
// component on most filesystems).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f ~^:?*[\\]|\.\.|@\{|\/\//;

function isValidBranchName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 255) {
    return false;
  }
  if (FORBIDDEN.test(name)) {
    return false;
  }
  if (name === "@" || name === "HEAD") {
    return false;
  }
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) {
    return false;
  }
  return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

module.exports = { isValidBranchName };
