write-ply
=========
Writes a PLY file to a stream

## Example

```javascript
var writePLY = require("../write-ply.js")

writePLY({ vertex: { x: [0, 0, 0], y: [1, 1, 0], z: [0, 1, 1] },
           face: { vertex_index: [ [0, 1, 2] ] } }).pipe(process.stdout)
```

## API

### `require("write-ply")(data[, options])`
Writes a JSON representation of a PLY file to disk.

* `data` is a JSON encoded PLY file.  It must have two fields:
    + `vertex` an object containing the properties of the vertices
    + `face` an object containing the properties of the faces
* `options` is an optional object containg separate flags.  In addition to the usual options you can set on a Readable stream, you can also set the flag `binary` which tells whether to use a binary format or ascii.

**Returns** A readable stream that you can pipe to wherever you want encoding the contents of the PLY file

## Credits
(c) 2013 Mikola Lysenko. MIT License