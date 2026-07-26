(function (root, factory) {
  const dxfArchive = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = dxfArchive;
  } else {
    root.WOODCASE_DXF_ARCHIVE = dxfArchive;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ZIP_MIME_TYPE = "application/zip";

  function encodeUtf8(value) {
    const bytes = [];
    for (const character of String(value)) {
      const code = character.codePointAt(0);
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (code <= 0x7ff) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code <= 0xffff) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }
    return Uint8Array.from(bytes);
  }

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = Array.from({ length: 256 }, (_entry, index) => {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
          value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        return value >>> 0;
      });
    }
    let crc = 0xffffffff;
    bytes.forEach((byte) => {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    });
    return (crc ^ 0xffffffff) >>> 0;
  }

  function writeUint16(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
  }

  function writeUint32(target, offset, value) {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
  }

  function joinByteArrays(arrays) {
    const joined = new Uint8Array(arrays.reduce((sum, array) => sum + array.length, 0));
    let offset = 0;
    arrays.forEach((array) => {
      joined.set(array, offset);
      offset += array.length;
    });
    return joined;
  }

  function validateFiles(files) {
    if (!Array.isArray(files) || !files.length) throw new Error("At least one ZIP file is required");
    const seen = new Set();
    files.forEach((file) => {
      if (
        !file
        || typeof file.filename !== "string"
        || !file.filename
        || file.filename.includes("/")
        || file.filename.includes("\\")
        || file.filename === "."
        || file.filename === ".."
      ) {
        throw new Error("ZIP filenames must be simple relative names");
      }
      if (seen.has(file.filename)) throw new Error(`Duplicate ZIP filename ${file.filename}`);
      seen.add(file.filename);
    });
  }

  function createStoredZip(files) {
    validateFiles(files);
    const localRecords = [];
    const centralRecords = [];
    let localOffset = 0;
    files.forEach((file) => {
      const name = encodeUtf8(file.filename);
      const data = encodeUtf8(file.content);
      const checksum = crc32(data);
      const localHeader = new Uint8Array(30);
      writeUint32(localHeader, 0, 0x04034b50);
      writeUint16(localHeader, 4, 20);
      writeUint16(localHeader, 6, 0x0800);
      writeUint16(localHeader, 8, 0);
      writeUint16(localHeader, 10, 0);
      writeUint16(localHeader, 12, 33);
      writeUint32(localHeader, 14, checksum);
      writeUint32(localHeader, 18, data.length);
      writeUint32(localHeader, 22, data.length);
      writeUint16(localHeader, 26, name.length);
      localRecords.push(localHeader, name, data);

      const centralHeader = new Uint8Array(46);
      writeUint32(centralHeader, 0, 0x02014b50);
      writeUint16(centralHeader, 4, 20);
      writeUint16(centralHeader, 6, 20);
      writeUint16(centralHeader, 8, 0x0800);
      writeUint16(centralHeader, 10, 0);
      writeUint16(centralHeader, 12, 0);
      writeUint16(centralHeader, 14, 33);
      writeUint32(centralHeader, 16, checksum);
      writeUint32(centralHeader, 20, data.length);
      writeUint32(centralHeader, 24, data.length);
      writeUint16(centralHeader, 28, name.length);
      writeUint32(centralHeader, 42, localOffset);
      centralRecords.push(centralHeader, name);
      localOffset += localHeader.length + name.length + data.length;
    });

    const centralDirectory = joinByteArrays(centralRecords);
    const endRecord = new Uint8Array(22);
    writeUint32(endRecord, 0, 0x06054b50);
    writeUint16(endRecord, 8, files.length);
    writeUint16(endRecord, 10, files.length);
    writeUint32(endRecord, 12, centralDirectory.length);
    writeUint32(endRecord, 16, localOffset);
    return joinByteArrays([...localRecords, centralDirectory, endRecord]);
  }

  return { ZIP_MIME_TYPE, encodeUtf8, crc32, createStoredZip };
});
