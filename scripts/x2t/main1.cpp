
// filex-office-editor (BRF Tech, 2026-10-10), from CryptPad's wrap-main.cpp
// (github.com/cryptpad/onlyoffice-x2t-wasm): appended to x2t's main.cpp by
// scripts/x2t/steps.sh. The page calls main1 with the path of a params.xml
// in the module's file system, as the Document Server calls x2t with one.
extern "C" {
    int main1(char* xmlPath) {
        char *argv[2] = {
            (char*)"",
            xmlPath
        };

        return main(2, argv);
    }
}
