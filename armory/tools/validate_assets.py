"""Validate offline portability and provenance of every bundled GLB."""
import hashlib
import json
from pathlib import Path
import struct

root=Path(__file__).resolve().parents[1]
catalog=json.loads((root/"catalog.json").read_text())
ids=set()
for model in catalog["models"]:
    assert model["id"] not in ids
    ids.add(model["id"])
    assert model["license"]=="CC0-1.0" and model["creator"] and model["source"].startswith("https://")
    assert model["licenseEvidence"].startswith("https://")
    data=(root/model["file"]).read_bytes()
    assert len(data)==model["bytes"] and hashlib.sha256(data).hexdigest()==model["sha256"],model["id"]
    magic,version,length=struct.unpack_from("<III",data)
    assert magic==0x46546C67 and version==2 and length==len(data)
    pos=12;chunks=[]
    while pos<len(data):
        size,kind=struct.unpack_from("<II",data,pos);pos+=8
        assert size%4==0 and pos+size<=len(data)
        chunks.append((kind,data[pos:pos+size]));pos+=size
    assert chunks[0][0]==0x4E4F534A and pos==len(data)
    doc=json.loads(chunks[0][1]);assert doc["meshes"] and doc["scenes"]
    binary=next((value for kind,value in chunks if kind==0x004E4942),b"")
    for buffer in doc.get("buffers",[]):
        assert not buffer.get("uri") and buffer["byteLength"]<=len(binary)
    for view in doc.get("bufferViews",[]):
        assert view.get("buffer",0)==0 and view.get("byteOffset",0)+view["byteLength"]<=len(binary)
    for image in doc.get("images",[]):
        assert "bufferView" in image or image.get("uri","").startswith("data:image/"),model["id"]
    assert not set(doc.get("extensionsRequired",[]))-{"KHR_materials_unlit","KHR_materials_specular","KHR_materials_ior","KHR_materials_transmission","KHR_materials_clearcoat","KHR_texture_transform","KHR_materials_emissive_strength"},model["id"]
assert len(ids)>=60
assert all(any(era in m["era"] for m in catalog["models"]) for era in ["Sci-fi","Modern","WWI","WWII","Antique"])
print("Validated",len(ids),"self-contained GLBs with SHA-256 hashes and CC0 source records.")
