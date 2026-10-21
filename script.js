//---PAGE SETUP
//The email will be viewed within an iframe since it is essentially its own HTML page
//TO-DO: Add the ability to resize the viewer to reflect different phone sizes (240x360, 480x852, etc.)
const viewer = document.getElementById('viewer');

//Drag and drop file viewer code was sourced from MDN's HTML Drag and Drop API
const input = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
input.addEventListener('change', () => showFile(input.files[0]));
dropZone.addEventListener('dragover', (e) => e.preventDefault());
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    showFile(e.dataTransfer.files[0]);
});

//---FLASH MANAGEMENT
//Function for reading .swf file sizes. This is needed because 
function swfSize(base64) {
  const bytes = Uint8Array.from(atob(base64.slice(0, 100)), c => c.charCodeAt(0)).slice(8);
  const bits = [...bytes.slice(0, 20)].map(b => b.toString(2).padStart(8, '0')).join('');
  const n = parseInt(bits.slice(0, 5), 2);
  const num = i => parseInt(bits.slice(5 + i * n, 5 + (i + 1) * n), 2) / 20;
  return { width: num(1) - num(0), height: num(3) - num(2) };
}

//---EMOJI MANAGEMENT
//Pixels at least this opaque (0-255) become solid and the rest become empty, so pictograms have hard edges like the simulator's
const PICT_ALPHA_CUTOFF = 100;

//Load a pictogram PNG as a data URI with hard edges. The viewer iframe is sandboxed, so it can't fetch the PNG for a CSS mask itself
const pictCache = {};
async function pictData(code) {
  if (!pictCache[code]) {
    const res = await fetch(`pictograms/i-mode Simulator/${code}.png`);
    if (!res.ok) throw new Error('missing ' + code);
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] >= PICT_ALPHA_CUTOFF ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    pictCache[code] = canvas.toDataURL('image/png');
  }
  return pictCache[code];
}

//This function will recolor the emoji based on the surrounding font color. 
function pictFontColor(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    let c = (el.tagName === 'FONT' && el.getAttribute('color')) || el.style.color || (el.tagName === 'BODY' && el.getAttribute('text')) || '';
    c = c.trim();
    if (/^[0-9a-f]{6}$/i.test(c)) c = '#' + c; //old HTML allowed colors without the #
    if (c && CSS.supports('color', c)) return c;
  }
  return null;
}

//---SOUND MANAGEMENT
//SMAF (.mmf) sounds can't play in a browser, so they're pulled out of the email and offered as downloads on the main page
function extractSounds(chunks) {
  const sounds = [];
  for (const chunk of chunks) {
    if (!/^Content-Type:\s*application\/(x-smaf|vnd\.smaf)/i.test(chunk.trim())) continue;
    const m = chunk.trim().match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);   // headers | body
    if (!m) continue;
    const nm = m[1].match(/name\s*=\s*"?([^";\r\n]+)"?/i);
    let name = (nm ? nm[1] : 'sound' + (sounds.length + 1))
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    if (!/\.(mmf|smaf)$/i.test(name)) name += '.mmf';
    sounds.push({ name, data: m[2].replace(/\s+/g, '') });
  }
  return sounds;
}

let soundUrls = [];
function showSounds(sounds) {
  const box = document.getElementById('sound-downloads');
  soundUrls.forEach(u => URL.revokeObjectURL(u));   // clean up the last email's links
  soundUrls = [];
  box.replaceChildren();
  box.hidden = true;
  for (const s of sounds) {
    try {
      const bytes = Uint8Array.from(atob(s.data), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/x-smaf' }));
      soundUrls.push(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = s.name;
      a.textContent = `♪ Download sound (${s.name})`;
      box.appendChild(a);
      box.appendChild(document.createElement('br'));
      box.hidden = false;
    } catch (e) {
      console.error('Bad sound data in', s.name, e);   // never break the whole email over a sound
    }
  }
}

//---MAIN
//Read a file and show it in the viewer
async function showFile(file) {
    const buffer = await file.arrayBuffer();
    //Try UTF-8 first (some files read better as UTF-8 instead of Shift_JIS despite being labelled as Shift_JIS), otherwise Shift_JIS
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        text = new TextDecoder('shift_jis').decode(buffer);
    }

    //The boundaries of the Deco-mail are pre-defined by text like boundary="3000000000". The boundaries separate different types of media: HTML, images, flash.
    const boundaries = [...text.matchAll(/boundary="([^"]+)"/g)].map(m => m[1]);
    const chunks = text.split(new RegExp('--(?:' + boundaries.join('|') + ')'));

    //Trim the HTML chunks and put them into the iframe
    let html = '';

    for (const chunk of chunks) {
      if (/^Content-Type:\s*text\/html/i.test(chunk.trim())) {
        html = chunk
        .replace(/Content-Type:\s*text\/html[^\r\n]*/i, '')
        .replace(/Content-Transfer-Encoding:[^\r\n]*/i, '');
      }
    }

    //Reduce media chunks to just ID and Base64 content, then inject into the email body (or, for smaf, puts it into a download area)
    for (const chunk of chunks) {
      if (/^Content-Type:\s*(image\/|application\/x-shockwave-flash)/i.test(chunk.trim())) {
        const mime = chunk.match(/Content-Type:\s*([\w\/.+-]+)/i)[1];
        const idMatch = chunk.match(/Content-ID:\s*<([^>]+)>/i);
        if (!idMatch) continue;
        const cid = idMatch[1];
        const data = chunk
            .replace(/Content-Type:[^\r\n]*/i, '')
            .replace(/Content-Transfer-Encoding:[^\r\n]*/i, '')
            .replace(/Content-ID:[^\r\n]*/i, '')
            .replace(/\s+/g, '');
        // Flash animations (all types)
        if (mime === 'application/x-shockwave-flash') {
          //Flash: Using the function defined earlier, read the size from the SWF header, then inject the data
          const { width, height } = swfSize(data);
          html = html.replace(
            new RegExp('<object([^>]*?)data="cid:' + cid + '"', 'i'),
            `<object$1 width="${width}" height="${height}" data="data:${mime};base64,${data}"`
          );
        // Image files (all types)
        } else {
          html = html.replaceAll('cid:' + cid + '"', 'data:' + mime + ';base64,' + data + '"');
        }
      }
    }


    //Some of the Deco-mail "templates" recovered from phones are actually introduction emails that come pre-installed on the device. Thus, they don't have editable template text, and they do not contain a HTML portion. 
    if (!html) {
      for (const chunk of chunks) {
        if (/^Content-Type:\s*application\/x-shockwave-flash/i.test(chunk.trim())) {
          const data = chunk.trim().replace(/^[\s\S]*?\r?\n\r?\n/, '').replace(/\s+/g, '');
          const { width, height } = swfSize(data);
          html = `<body style="margin:0">
                  <div style="width:100%; max-width:${width}px; aspect-ratio:${width}/${height}">
                  <object data="data:application/x-shockwave-flash;base64,${data}" type="application/x-shockwave-flash" width="100%" height="100%"></object>
                  </div>
                  </body>`;
        }
      }
    }

  //Replace pictogram characters with colored masks. 
  //The color is the surrounding font color if there is one, otherwise the pictogram's default color comes from the table in pictograms.js (colors are sourced from NTT DoCoMo's i-mode creation documents).
  if (/[\uE63E-\uE757]/.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const parts = node.nodeValue.split(/([\uE63E-\uE757])/); //odd entries are pictograms
      if (parts.length === 1) continue;
      const color = pictFontColor(node);
      for (let i = 1; i < parts.length; i += 2) {
        const code = parts[i].codePointAt(0).toString(16);
        try {
          const url = `url('${await pictData(code)}')`;
          const span = doc.createElement('span');
          span.className = 'pict';
          span.setAttribute('style', `background-color:${color || pictColor(code)};-webkit-mask-image:${url};mask-image:${url}`);
          parts[i] = span;
        } catch {
          parts[i] = ''; //no PNG for this code
        }
      }
      node.replaceWith(...parts);
    }
    html = doc.documentElement.outerHTML;
  }

    //Remove modern webpage styling that will mess with the formatting
    //Also adds text stylings
    html = `<style>
        /* remove the browser's default page margin, change default font size */
        body { margin: 0; font-family: "MS Gothic", "MS PGothic", monospace; font-size: 20px; line-height: 1; }
        font { font-size: 20px; }
        font[size="1"] { font-size: 16px; }
        font[size="2"] { font-size: 18px; }
        font[size="3"] { font-size: 20px; }
        font[size="4"] { font-size: 24px; }

        img { vertical-align: bottom; }

        /* fake the old <blink> tag */
        blink { animation: blink 0.75s step-end infinite; }
        @keyframes blink { 50% { visibility: hidden; } }

        /* pictograms */
        span.pict { display: inline-block; width: 1em; height: 1em; vertical-align: middle;
          -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
          -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
          image-rendering: pixelated; }

        </style>` + html;

    //Slows down marquee speed to resemble i-mode HTML simulator
    html = html.replace(/<marquee/gi, '<marquee scrollamount="3"');

    //Add Ruffle integration
    html = `<script>window.RufflePlayer={config:{autoplay:"on",unmuteOverlay:"hidden",letterbox:"off"}};<\/script>
<script src="https://unpkg.com/@ruffle-rs/ruffle"><\/script>` + html;

    //Sounds: strip <bgsound> (its cid: can't load), then offer the files for download
    html = html.replace(/<bgsound[^>]*>/gi, '');
    showSounds(extractSounds(chunks));

    //View email template
    viewer.srcdoc = html;
}