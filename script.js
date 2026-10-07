//Constant for file uploader
const input = document.getElementById('file-input');
//Constant for the drop zone
const dropZone = document.getElementById('drop-zone');
//Constant for the .dmt viewer
const viewer = document.getElementById('viewer');
//Pick a file through the dialog
input.addEventListener('change', () => showFile(input.files[0]));
//Without this, the browser won't let a drop happen
dropZone.addEventListener('dragover', (e) => e.preventDefault());
//Drop a file onto the drop zone
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); //stop the browser from opening the file itself
    showFile(e.dataTransfer.files[0]);
});

//Function for reading .swf file sizes
function swfSize(base64) {
  const bytes = Uint8Array.from(atob(base64.slice(0, 100)), c => c.charCodeAt(0)).slice(8);
  const bits = [...bytes.slice(0, 20)].map(b => b.toString(2).padStart(8, '0')).join('');
  const n = parseInt(bits.slice(0, 5), 2);
  const num = i => parseInt(bits.slice(5 + i * n, 5 + (i + 1) * n), 2) / 20;
  return { width: num(1) - num(0), height: num(3) - num(2) };
}

//Read a .dmt file and show it in the viewer
async function showFile(file) {
    const buffer = await file.arrayBuffer();
    //Try UTF-8 first (some files read better as UTF-8 instead of Shift_JIS), otherwise Shift_JIS
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        text = new TextDecoder('shift_jis').decode(buffer);
    }

    //Cut the file into its parts
    const boundaries = [...text.matchAll(/boundary="([^"]+)"/g)].map(m => m[1]);
    const chunks = text.split(new RegExp('--(?:' + boundaries.join('|') + ')'));

    //Establish body of email
    let html = '';

    for (const chunk of chunks) {
      if (/^Content-Type:\s*text\/html/i.test(chunk.trim())) {
        html = chunk
        .replace(/Content-Type:\s*text\/html[^\r\n]*/i, '')
        .replace(/Content-Transfer-Encoding:[^\r\n]*/i, '');
      }
    }

    //Reduce media chunks to just ID and Base64 content, then inject into the email body
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

        if (mime === 'application/x-shockwave-flash') {
          //Flash: read the size from the SWF header, then inject the data
          const { width, height } = swfSize(data);
          html = html.replace(
            new RegExp('<object([^>]*?)data="cid:' + cid + '"', 'i'),
            `<object$1 width="${width}" height="${height}" data="data:${mime};base64,${data}"`
          );
          //Else = images
        } else {
          html = html.replaceAll('cid:' + cid + '"', 'data:' + mime + ';base64,' + data + '"');
        }
      }
    }


    //Flash-only mail (no HTML part): show the Flash directly
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

    //Replace pictogram characters with images
    html = html.replace(/[\uE63E-\uE757]/g, ch => {
      const code = ch.codePointAt(0).toString(16);
      return `<img class="pict" src="pictograms/${code}.png" alt="">`;
    });

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
        img.pict { width: 1em; height: 1em; vertical-align: middle; }

        </style>` + html;

    //Slows down marquee speed to resemble i-mode HTML simulator
    html = html.replace(/<marquee/gi, '<marquee scrollamount="3"');

    //Add Ruffle integration
    html = `<script>window.RufflePlayer={config:{autoplay:"on",unmuteOverlay:"hidden",letterbox:"off"}};<\/script>
<script src="https://unpkg.com/@ruffle-rs/ruffle"><\/script>` + html;

    //View email template
    viewer.srcdoc = html;
}