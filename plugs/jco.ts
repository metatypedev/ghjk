import {
  DownloadEnv,
  ExecPathEnv,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  Plug,
} from "../plug.ts";

export function jco() {
  return new class extends Plug {
    name = "jco";
    dependencies = ["node"];

    execEnv(env: ExecPathEnv) {
      throw new Error("Method not implemented.");
      return {};
    }

    listBinPaths(env: ListBinPathsEnv) {
      throw new Error("Method not implemented.");
      return {};
    }

    listAll(env: ListAllEnv) {
      const pkg = "@bytecodealliance/jco";
      const metadataRequest = await fetch(`https://registry.npmjs.org/${pkg}`);
      const metadata = await metadataRequest.json();

      const versions = Object.keys(metadata.versions);
      versions.sort();

      console.log(versions);
      return versions;
    }

    download(env: DownloadEnv) {
      throw new Error("Method not implemented.");
    }

    install(env: InstallEnv) {
      /*
      npm install -g @bytecodealliance/jco
      or

PACKAGE=@bytecodealliance/jco
PACKAGE_INTERNAL=jco
BIN="jco"
BIN_PATH="${ASDF_INSTALL_PATH}/src/jco.js"

if [[ "${ASDF_INSTALL_TYPE:-version}" == 'ref' ]]; then
    echo >&2 "⛔ This plugin does not support installing by ref."
    exit 1
fi

TARBALL_URL="https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE_INTERNAL}-${ASDF_INSTALL_VERSION}.tgz"
echo "Downloading ${PACKAGE} v${ASDF_INSTALL_VERSION} from ${TARBALL_URL}"

mkdir -p "${ASDF_INSTALL_PATH}"
curl --silent --fail --show-error --location "${TARBALL_URL}" |
    tar xzf - --strip-components=1 --no-same-owner -C "${ASDF_INSTALL_PATH}"

chmod +x "${BIN_PATH}"
mkdir -p "${ASDF_INSTALL_PATH}/bin"
ln -sf "${BIN_PATH}" "${ASDF_INSTALL_PATH}/bin/${BIN}"
      */
      throw new Error("Method not implemented.");
    }
  }();
}
