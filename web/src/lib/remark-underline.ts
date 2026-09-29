type Node={type:string;value?:string;children?:Node[];data?:{hName:string}};
// A small explicit extension: ++underlined text++. No raw HTML is enabled.
export function remarkUnderline(){return (tree:Node)=>{
 function walk(node:Node){if(!node.children||["code","inlineCode"].includes(node.type))return;node.children=node.children.flatMap(child=>{if(child.type!=="text"||!child.value){walk(child);return [child];}const pieces:Node[]=[];let end=0;for(const match of child.value.matchAll(/\+\+([^\n]+?)\+\+/g)){pieces.push({type:"text",value:child.value.slice(end,match.index)});pieces.push({type:"underline",data:{hName:"u"},children:[{type:"text",value:match[1]}]});end=match.index!+match[0].length;}if(!pieces.length)return [child];pieces.push({type:"text",value:child.value.slice(end)});return pieces;});}
 walk(tree);
};}
