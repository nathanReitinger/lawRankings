'''
PythonAnywhere: send lawschoolrankings.pythonanywhere.com to the new site on GitHub Pages.

How to install (PythonAnywhere -> Web tab):
1. Under "Code", click the "WSGI configuration file" link (/var/www/lawschoolrankings_pythonanywhere_com_wsgi.py).
2. Replace everything in that file with this file's contents and click Save.
3. Click the green "Reload" button at the top of the Web tab.

Every old address now answers with a permanent redirect (301), so old links and bookmarks keep working.
The old Flask app (r.py, templates/, author/auth.csv) is no longer used.
'''

NEW_SITE = 'https://nathanreitinger.github.io/lawRankings/'
OLD_TO_NEW = {'/FAQ': 'faq.html', '/faq': 'faq.html'}


def application(environ, start_response):
    target = NEW_SITE + OLD_TO_NEW.get(environ.get('PATH_INFO', '/'), '')
    start_response('301 Moved Permanently', [('Location', target), ('Content-Type', 'text/html; charset=utf-8')])
    return [f'<p>Law School Rankings has moved to <a href="{target}">{target}</a>.</p>'.encode()]
