var writePLY = require("../write-ply.js")

writePLY({ vertex: { x: [0, 0, 0], y: [1, 1, 0], z: [0, 1, 1] },
           face: { vertex_index: [ [0, 1, 2] ] } }).pipe(process.stdout)
