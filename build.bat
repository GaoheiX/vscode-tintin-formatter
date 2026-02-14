@echo off
rem npm version major --no-git-tag-version
rem npm version minor --no-git-tag-version
rem npm version patch --no-git-tag-version
call npm run vscode:prepublish
call vsce package
call code --install-extension tintin-formatter-1.1.1.vsix
rem https://marketplace.visualstudio.com/manage/publishers/gaohei