import urllib.request
import ssl
import re

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

try:
    req = urllib.request.Request('https://samgtu.ru/students/students-schedule', headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req, context=ctx, timeout=10).read().decode('utf-8', errors='ignore')
    title = re.search(r'<title>(.*?)</title>', html, re.I | re.S)
    print('Title:', title.group(1).strip() if title else 'No title')
    
    links = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.I | re.S)
    print('Total links:', len(links))
    found = 0
    for href, text in links:
        clean_text = re.sub(r'<[^>]+>', '', text).strip()
        if any(k in clean_text.lower() or k in href.lower() for k in ['фаид', 'аса', 'архитект', 'расписан', 'очн', 'бакалавр', 'pdf', 'xlsx', 'курс']):
            print(f'  [{clean_text}] -> {href}')
            found += 1
            if found > 30:
                break
except Exception as e:
    print('Error:', e)
