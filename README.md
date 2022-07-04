# mst-codemod-to-mobx
A codemod to migrate to MobX from MobX-State-Tree

**How to run the codemod?**

The codemod is provided as npm package command line tool. It has been written using the TypeScript parser, so it will succefully support either TS or regular JavaScript source files.

To run the codemod, you need to first install it globally by `npm install -g mst-codemod-to-mobx`.
After that, the `mst-codemod-to-mobx` command will be available in your command line.

To perform the codemod, you need to call in your command line `mst-codemod-to-mobx` followed by the filename you want to codemod. A `.bak` file with the original source will be created for backup purposes, and the file you provided will be updated to the new syntax! Have fun!

