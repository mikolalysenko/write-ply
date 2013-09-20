"use strict"

var Readable = require("stream").Readable
var util = require("util")
var littleEndian = require("is-little-endian")

module.exports = writePLY

var SUFFIX = littleEndian ? "LE" : "BE"

var TYPE_DATA = {
  "char":   [ 1, "writeInt8" ],
  "uchar":  [ 1, "writeUInt8" ],
  "short":  [ 2, "writeInt16" + SUFFIX ],
  "ushort": [ 2, "writeUInt16" + SUFFIX ],
  "int":    [ 4, "writeInt32" + SUFFIX ],
  "uint":   [ 4, "writeUInt32" + SUFFIX ],
  "float":  [ 4, "writeFloat" + SUFFIX ],
  "double": [ 8, "writeDouble" + SUFFIX ]
}

var READER_STATE = {
  HEADER: 0,
  VERTEX: 1,
  FACE: 2,
  DONE: 3
}

function propertyType(t) {
  if(t instanceof Int8Array) {
    return "char"
  } else if(t instanceof Uint8Array) {
    return "uchar"
  } else if(t instanceof Int16Array) {
    return "short"
  } else if(t instanceof Uint16Array) {
    return "ushort"
  } else if(t instanceof Int32Array) {
    return "int"
  } else if(t instanceof Uint32Array) {
    return "uint"
  } else if(t instanceof Float32Array) {
    return "float"
  } else if(t instanceof Float64Array) {
    return "double"
  } else if(t instanceof Array) {
    if(typeof t[0] === "number") {
      for(var i=0; i<t.length; ++i) {
        if(t[i] !== t[i]>>0) {
          return "double"
        }
      }
      return "int"
    } else {
      var l = 0
      var subType = "int"
      for(var i=0; i<t.length; ++i) {
        l = Math.max(l, t[i].length)
        if(subType === "int") {
          subType = propertyType(t[i])
        }
      }
      if(l < 256) {
        return "list uchar " + subType
      } else if(l < 65536) {
        return "list ushort " + subType
      } else {
        return "list uint " + subType
      }
    }
  }
  throw new Error("Unknown type for property")
}

function createPropertyHeader(object, name, props, count, types) {
  var result = []
  result.push([ "element ", name, " ", count ].join(""))
  for(var i=0; i<props.length; ++i) {
    result.push(["property ", types[i], " ", props[i]].join(""))
  }
  return result.join("\n")
}

function flatten(obj, props) {
  var result = new Array(props.length)
  for(var i=0; i<props.length; ++i) {
    result[i] = obj[props[i]]
  }
  return result
}

function compileEmitFunctionAscii(types) {
  var code = ["this.push(["]
  for(var i=0; i<types.length; ++i) {
    var t = types[i].split(" ")
    if(t[0] === "list") {
      var localVar = "d" + i
      var localPrefix = "d" + i + "_"
      var loop = [ "var " + localVar + "=[]" ]
      var localN, localJ, localP
      for(var j=0; j<t.length; j+=3) {
        localN = localPrefix + "n" + j
        localJ = localPrefix + "j" + j
        localP = localPrefix + "p" + j
      
        if(j === 0) {
          loop.push(["var ", localP, "=data[", i, "][i]"].join(""))
        } else {
          loop.push(["var ", localP, "=", localPrefix, j-3, "[j", j-3, "]"].join(""))
        }
        loop.push(["var ", localN, "=", localP, ".length"].join(""))
        loop.push([localVar, ".push(", localN, ")"].join(""))
        loop.push(["for(var ", localJ, "=0;", localJ, "<", localN, ";++", localJ, "){"].join(""))
      }
      loop.push([localVar, ".push(", localP, "[", localJ, "])"].join(""))
      for(var j=0; j<t.length; j+=3) {
        loop.push("}")
      }
      code.unshift(loop.join("\n"))
      if(i < types.length - 1) {
        code.push(localVar + ".join(' '),")
      } else {
        code.push(localVar + ".join(' ')")
      }
    } else {
      if(i < types.length - 1) {
        code.push(["data[", i, "][i],"].join(""))
      } else {
        code.push(["data[", i, "][i]"].join(""))
      }
    }
  }
  code.push("].join(' ')+'\\n','ascii')")
  return new Function("data", "i", code.join("\n"))
}

function compileEmitFunctionBinary(types) {
  var size = 0
  var variableSize = false
  for(var i=0; i<types.length; ++i) {
    var td = TYPE_DATA[types[i]]
    if(td) {
      size += td[0]
    } else {
      variableSize = true
    }
  }
  if(variableSize) {
    var code = [ "var n=" + size ]
    //First pass:  Compute the size of the buffer
    for(var i=0; i<types.length; ++i) {
      var t = types[i].split(" ")
      if(t[0] === "list") {
        var localPrefix = "d" + i + "_"
        var localN, localJ, localP
        for(var j=0; j<t.length; j+=3) {
          localN = localPrefix + "n" + j
          localJ = localPrefix + "j" + j
          localP = localPrefix + "p" + j
          if(j === 0) {
            code.push(["var ", localP, "=data[", i, "][i]"].join(""))
          } else {
            code.push(["var ", localP, "=", localPrefix, j-3, "[j", j-3, "]"].join(""))
          }
          code.push(["var ", localN, "=", localP, ".length"].join(""))
          code.push(["n+=" + TYPE_DATA[t[j+1]][0]].join(""))
          
          if(j + 3 < t.length) {
            code.push(["for(var ", localJ, "=0;", localJ, "<", localN, ";++", localJ, "){"].join(""))
          } else {
            code.push(["n+=", localN, "*", TYPE_DATA[t[j+2]][0]].join(""))
          }
        }
        for(var j=3; j<t.length; j+=3) {
          code.push("}")
        }
      }
    }
    //Now allocate buffer
    code.push("var b=new Buffer(n),ptr=0")
    //Second pass: Fill in buffer
    for(var i=0; i<types.length; ++i) {
      var t = types[i].split(" ")
      if(t[0] === "list") {
        var localPrefix = "d" + i + "_"
        var localN, localJ, localP
        for(var j=0; j<t.length; j+=3) {
          localN = localPrefix + "n" + j
          localJ = localPrefix + "j" + j
          localP = localPrefix + "p" + j
          if(j === 0) {
            code.push(["var ", localP, "=data[", i, "][i]"].join(""))
          } else {
            code.push(["var ", localP, "=", localPrefix, j-3, "[j", j-3, "]"].join(""))
          }
          code.push(["var ", localN, "=", localP, ".length"].join(""))
          code.push(["b.", TYPE_DATA[t[j+1]][1], "(", localN, ",ptr,true)"].join(""))
          code.push("ptr+=" + TYPE_DATA[t[j+1]][0])
          code.push(["for(var ", localJ, "=0;", localJ, "<", localN, ";++", localJ, "){"].join(""))
        }
        code.push(["b.", TYPE_DATA[t[t.length-1]][1], "(", localP, "[", localJ, "],ptr,true)"].join(""))
        code.push("ptr+=" + TYPE_DATA[t[t.length-1]][0])
        for(var j=0; j<t.length; j+=3) {
          code.push("}")
        }
      } else {
        code.push(["b.", TYPE_DATA[types[i]][1], "(ptr,data[", i, "][i],true)"].join(""))
      }
    }
    code.push("this.push(b)")
    return new Function("data", "i", code.join("\n"))
  } else {
    //Fixed size, type easy case
    var code = [ ["var b=new Buffer(", size, ")"].join("") ]
    var ptr = 0
    for(var i=0; i<types.length; ++i) {
      var td = TYPE_DATA[types[i]]
      code.push(["b.", td[1], "(data[", i, "][i],", ptr, ",true)"].join(""))
      ptr += td[0]
    }
    code.push("this.push(b)")
    return new Function("data", "i", code.join("\n"))
  }
}

var CACHED = {}

function getEmit(binary, types) {
  var typeSig = (binary ? "binary" : "ascii") + "&" + types.join()
  if(typeSig in CACHED) {
    return CACHED[typeSig]
  } else {
    var emit
    if(binary) {
      emit = compileEmitFunctionBinary(types)
    } else {
      emit = compileEmitFunctionAscii(types)
    }
    CACHED[typeSig] = emit
    return emit
  }
}


function PLYReadStream(header, vertex, emitVertex, vertexCount, face, emitFace, faceCount, options) {
  Readable.call(this, options)

  this._state = READER_STATE.HEADER
  
  this._header = header
  
  this._vertexData = vertex
  this._emitVertex = emitVertex
  this._vertexCount = vertexCount
  this._currentVertex = 0
  
  this._faceData = face
  this._emitFace = emitFace
  this._faceCount = faceCount
  this._currentFace = 0
  
  this._bops = bops
}

util.inherits(PLYReadStream, Readable)

PLYReadStream.prototype._read = function(sz) {
  switch(this._state) {
    case READER_STATE.HEADER:
      this.push(this._header, "ascii")
      this._state = READER_STATE.VERTEX
    break
    
    case READER_STATE.VERTEX:
      this._emitVertex(this._vertexData, this._currentVertex++)
      if(this._currentVertex >= this._vertexCount) {
        this._state = READER_STATE.FACE
      }
    break
    
    case READER_STATE.FACE:
      this._emitFace(this._faceData, this._currentFace++)
      if(this._currentFace >= this._faceCount) {
        this._state = READER_STATE.DONE
      }    
    break
    
    case READER_STATE.DONE:
      this.push(null)
    break
  }
}

function getComments(data) {
  if(data.comments) {
    return data.comments.map(function(c) {
      return "comment " + c.replace(/\\/g, "\\").replace(/\n/g, "\\n")
    }).join("\n")
  }
  return "comment Generated by write-ply.js"
}


function writePLY(data, options) {
  options = options || {}
  var binary = !!options.binary
  var vertex = data.vertex || {}
  var vertexProps = Object.keys(vertex)
  var face = data.face || {}
  var faceProps = Object.keys(face)
  
  //Get vertex counts
  var vertexCount = 0
  if(vertexProps.length > 0) {
    vertexCount = vertex[vertexProps[0]].length
  }
  var faceCount = 0
  if(faceProps.length > 0) {
    faceCount = face[faceProps[0]].length
  }
  
  //Compute type for vertex/face formats
  var vertexTypes = new Array(vertexProps.length)
  for(var i=0; i<vertexProps.length; ++i) {
    vertexTypes[i] = propertyType(vertex[vertexProps[i]])
  }
  var faceTypes = new Array(faceProps.length)
  for(var i=0; i<faceProps.length; ++i) {
    faceTypes[i] = propertyType(face[faceProps[i]])
  }
  
  //Grab serialization methods
  var emitVertex = getEmit(binary, vertexTypes)
  var emitFace = getEmit(binary, faceTypes)

  //Evaluate PLY header
  var header = [
      "ply"
    , ["format ", binary ? (littleEndian ? "binary_little_endian" : "binary_big_endian") : "ascii", " 1.0"].join("")
    , getComments(data)
    , createPropertyHeader(vertex, "vertex", vertexProps, vertexCount, vertexTypes)
    , createPropertyHeader(face, "face", faceProps, faceCount, faceTypes)
    , "end_header\n"
  ].join("\n")
  
  //Create stream and return
  return new PLYReadStream(header
    , flatten(vertex, vertexProps)
    , emitVertex
    , vertexCount
    , flatten(face, faceProps)
    , emitFace
    , faceCount
    , options)
}