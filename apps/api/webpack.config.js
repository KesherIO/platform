const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');
const fs = require('fs');

// pdfkit loads AFM fonts from __dirname/data at runtime; when bundled the
// __dirname becomes dist/, so we copy the font data directory after each emit.
class CopyPdfkitFontsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('CopyPdfkitFonts', () => {
      const src = join(__dirname, 'node_modules/pdfkit/js/data');
      const dest = join(__dirname, 'dist/data');
      if (!fs.existsSync(src)) return;
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const file of fs.readdirSync(src)) {
        fs.copyFileSync(join(src, file), join(dest, file));
      }
    });
  }
}

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
    new CopyPdfkitFontsPlugin(),
  ],
};
