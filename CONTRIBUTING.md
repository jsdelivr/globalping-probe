# Contributing guide

Hi! We're really excited that you're interested in contributing! Before submitting your contribution, please read through the following guide.

## General guidelines

-   Bug fixes and changes discussed in the existing issues are always welcome.
-   For new ideas, please open an issue to discuss them before sending a PR.
-   Make sure your PR passes `npm test` and has [appropriate commit messages](https://github.com/jsdelivr/globalping-probe/commits/master).

## Project setup

You need to have the [main API](https://github.com/jsdelivr/globalping#development) running before running the probe!

You can run the project by following these steps:

1. Clone repository.
2. `npm install`
3. `npm run dev`

If you run into any errors due to failed scripts, try installing the [unbuffer package](https://command-not-found.com/unbuffer) on your local machine. WSL users will need to do this.

### Testing

A single command to run everything: `npm test`

To run a specific linter or a test suite, please see the scripts section of [package.json](package.json).

Most IDEs have plugins integrating the used linter (eslint), including support for automated fixes on save.
