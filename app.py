import os
import time
import urllib.request
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, request
from bs4 import BeautifulSoup

app = Flask(__name__)

# Simple in-memory cache
# Holds: {'timestamp': float, 'updates': list}
cache = {
    'timestamp': 0,
    'updates': []
}
CACHE_DURATION_SEC = 3600  # Cache for 1 hour by default

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"

def fetch_and_parse_feed():
    """Fetches the XML feed and parses it into granular individual updates."""
    req = urllib.request.Request(
        FEED_URL, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AntigravityReleaseTracker/1.0'}
    )
    
    with urllib.request.urlopen(req, timeout=15) as response:
        xml_data = response.read()
        
    root = ET.fromstring(xml_data)
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    entries = root.findall('atom:entry', ns)
    
    parsed_updates = []
    
    for entry in entries:
        # Extract metadata
        title_elem = entry.find('atom:title', ns)
        date_str = title_elem.text if title_elem is not None else "Unknown Date"
        
        updated_elem = entry.find('atom:updated', ns)
        updated_str = updated_elem.text if updated_elem is not None else ""
        
        link_elem = entry.find("atom:link[@rel='alternate']", ns)
        if link_elem is None:
            link_elem = entry.find("atom:link", ns)
        base_link = link_elem.attrib.get('href') if link_elem is not None else "https://cloud.google.com/bigquery/docs/release-notes"
        if '#' in base_link:
            base_link = base_link.split('#')[0]
        
        content_elem = entry.find('atom:content', ns)
        content_html = content_elem.text if content_elem is not None else ""
        
        soup = BeautifulSoup(content_html, 'html.parser')
        
        current_type = None
        current_elements = []
        
        def save_current_item(index):
            if current_type and current_elements:
                item_soup = BeautifulSoup("", "html.parser")
                for el in current_elements:
                    item_soup.append(el)
                
                # Rewrite relative URLs to absolute
                for a in item_soup.find_all('a', href=True):
                    if a['href'].startswith('/'):
                        a['href'] = 'https://cloud.google.com' + a['href']
                        
                item_html = str(item_soup)
                item_text = item_soup.get_text(separator=' ').strip()
                
                # Clean up multiple whitespaces
                item_text = ' '.join(item_text.split())
                
                # Generate a unique ID based on date and index
                safe_date = date_str.replace(' ', '_').replace(',', '')
                unique_id = f"{safe_date}_{index}"
                
                # Form a deep link to this specific section on Google Cloud's page if possible
                item_link = f"{base_link}#{safe_date}"
                
                parsed_updates.append({
                    'id': unique_id,
                    'date': date_str,
                    'type': current_type,
                    'html': item_html,
                    'text': item_text,
                    'link': item_link
                })
        
        # Iterate through HTML elements to group by heading (h3)
        item_idx = 0
        for child in soup.children:
            if child.name == 'h3':
                save_current_item(item_idx)
                current_type = child.get_text().strip()
                current_elements = []
                item_idx += 1
            elif child.name is not None:
                if current_type is None:
                    current_type = "Update"
                current_elements.append(child)
                
        save_current_item(item_idx)
        
    return parsed_updates

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/releases')
def get_releases():
    force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
    current_time = time.time()
    
    # Check if cache is valid
    if not force_refresh and cache['updates'] and (current_time - cache['timestamp'] < CACHE_DURATION_SEC):
        return jsonify({
            'source': 'cache',
            'last_updated': int(cache['timestamp']),
            'updates': cache['updates']
        })
        
    try:
        updates = fetch_and_parse_feed()
        cache['updates'] = updates
        cache['timestamp'] = current_time
        return jsonify({
            'source': 'live',
            'last_updated': int(current_time),
            'updates': updates
        })
    except Exception as e:
        # If live fetch fails, fallback to cache if available
        if cache['updates']:
            return jsonify({
                'source': 'fallback_cache',
                'last_updated': int(cache['timestamp']),
                'updates': cache['updates'],
                'error': str(e)
            }), 200
        else:
            return jsonify({
                'error': 'Failed to fetch release notes and no cached data available.',
                'details': str(e)
            }), 500

if __name__ == '__main__':
    # Listen on all interfaces so it runs correctly in codespaces
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
