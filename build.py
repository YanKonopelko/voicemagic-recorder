from pathlib import Path
root = Path(__file__).parent
html = (root / 'src/recorder.html').read_text('utf-8')
for name in ('recorder-locales.js', 'recorder.js', 'recorder-wizard.js'):
    html = html.replace(f'<script src="{name}"></script>', '<script>\n' + (root / 'src' / name).read_text('utf-8') + '\n</script>')
for name in ('index.html', 'offline/VoiceMagic-Recorder.html'):
    (root / name).write_text(html, encoding='utf-8', newline='\n')
