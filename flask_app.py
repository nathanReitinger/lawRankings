'''
1. main gen_rank() to get auth.csv latest 
2. r.py flask app 

'''


from flask import Flask, render_template, request, render_template_string
import pandas as pd
import numpy as np
import datetime
import sys

path = '/home/lawSchoolRankings/lawSchoolRankings'
if path not in sys.path:
    sys.path.insert(0, path)

from flask_app import app as application

app = Flask(__name__)

def ranker(num_areas, weights):
    # print(ranker(1, [0.5, 0.3,  0.2]))
    # num_areas are the groups of papers (gen_top_3, gen_top_50, sci_tech)
    # weights are all professors at each school pooled in terms of their weighted score: 
        # one paper, one author:            1
        # one paper, two authors:           .5 
        # one paper, five authors:          1/5 = 0.2 
        # two papers, two authors each:     sum([1/2, 1/2]) = 1.0  
    to_ret = 0
    first_step = 1 * (sum(weights) + 1)
    second_step = pow(first_step, (1 / num_areas))
    to_ret = second_step
    rounded = round(to_ret, 1)
    return rounded 

@app.route('/FAQ')
def subversion_page():
    # Logic to gather data for subversion
    data='hi'
    return render_template('faq.html', data=data)


@app.route('/', methods=['GET', 'POST'])
def index():
    
    ## default view
    selected_from = None
    selected_to = None
    journal_selection = ['General - Top 10']
    specialty_selection_rank = np.inf
    specialty_rank_map = {
        "top1button": 1,
        "top3button": 3,
        "top5button": 5,
        "top10button": 10,
        "top25button": 25,
        "topallbutton": np.inf
    }
    first_load = '<p>yes</p>'

    if request.method == 'POST':
        ## get the year range
        selected_from = int(request.form.get('from_year'))
        selected_to = int(request.form.get('to_year'))

        ## get the jouranls selected 
        journal_selection = selected_journals = request.form.getlist('journal_selection')

        get_rank = request.form.get('specialty_selection_rank')
        print("===========> ", get_rank)

        try:
            specialty_selection_rank = specialty_rank_map[get_rank]
        except:
            print("no cut-off passed for specialty journal ranking")

        first_load = '<p>no</p>'
        

    print("_____________________________________________________________")
    print(f"Selected From Year: {selected_from} To Year: {selected_to}")  
    print(f"Journal Selected: {journal_selection}")

    # csv parse 
    csv_path = 'author/auth.csv'
    df = pd.read_csv(csv_path)
    df = df[(df['inferred_year'] >= selected_from) & (df['inferred_year'] <= selected_to)]
    # df[['rank', 'type']] = df['journal_ranking'].str.split('---type---', n=1, expand=True)
    # print(df.head())
    # print(len(df))

    ### get specific journals selected
    keepers_from_journal_selection = []
    kept_journals = []
    journals_to_get = None
    ranks_to_get = None
    for selected in journal_selection:
        print(selected)
        if selected == 'General - All':
            journals_to_get = 'General'
            ranks_to_get = np.inf
        elif selected == 'General - Top 1':
            journals_to_get = 'General'
            ranks_to_get = 1
        elif selected == 'General - Top 3':
            journals_to_get = 'General'
            ranks_to_get = 3
        elif selected == 'General - Top 10':
            journals_to_get = 'General'
            ranks_to_get = 10
        elif selected == 'General - Top 25':
            journals_to_get = 'General'
            ranks_to_get = 25
        elif selected == 'General - Top 50':
            journals_to_get = 'General'
            ranks_to_get = 50
        elif selected == 'General - Top 100':
            journals_to_get = 'General'
            ranks_to_get = 100
        elif selected == 'General - None':
            journals_to_get = 'General'
            ranks_to_get = 0
        # elif selected == 'Speciality - All':
        #     journals_to_get = 'special_all'
        #     ranks_to_get = np.inf
        # elif 'speciality---' in selected:
        #     journals_to_get = selected.replace('speciality---','')
        #     ranks_to_get = 3
        ## if not general selected, then just use the name 
        else:
            journals_to_get = selected
            ranks_to_get = specialty_selection_rank
        print("Journal", journals_to_get)
        kept_journals.append(journals_to_get + "---" + str(ranks_to_get))
        print("Ranks", ranks_to_get)
        # if journals_to_get == 'special_all':
        #         tmp_df = df[~df['journal_type'].str.contains('General')]
        #         keepers_from_journal_selection.append(tmp_df)
        # else:
        tmp_df = df[(df['journal_type'] == journals_to_get) & (df['journal_ranking'] <= ranks_to_get)]
        keepers_from_journal_selection.append(tmp_df)

    if len(keepers_from_journal_selection) == 0:
        return render_template('index.html')
    
    print("SLICING ON", kept_journals)

    ## final dataframe slice to get information from
    df = pd.concat(keepers_from_journal_selection).drop_duplicates().reset_index(drop=True)
    # print(df.head())
    # print(len(df))
    # print(df['journal_type'].unique())
    

    final_view = []
    num_areas = len(journal_selection)
    for author_school_is, school_group in df.groupby('author_school'):
        school = author_school_is
        if school != 'todo':
            faculty_count = len(school_group['author'].unique())
            # print(faculty_count)
            average_count = 0 # 
            authors_adjusted_counts = {}
            for this_author,author_group in school_group.groupby('author'):
                sum_adjusted = sum(author_group['weights'])
                authors_adjusted_counts[this_author] = sum_adjusted
            weights_for_calc = list(authors_adjusted_counts.values())
            average_count = ranker(num_areas, weights_for_calc)
            
            for this_author,author_group in school_group.groupby('author'):
                adjusted_count = round(sum(author_group['weights']), 1)
                number_of_publications = len(author_group['weights'])
                num_papers = len(author_group['title'].unique())
                if num_papers != number_of_publications:
                    print("ERROR!")
                    print(num_papers)
                    print(number_of_publications)
                    print(author_group['weights'])
                    print(author_group['title'])
                    print(this_author)
                    # sys.exit()
                list_of_titles = author_group['title'].unique()
                break_string = "----break----"
                list_of_titles_as_string = break_string.join(map(str, list_of_titles))

                final_view.append([school, average_count, faculty_count, this_author, number_of_publications, adjusted_count, list_of_titles_as_string])

    df_final = pd.DataFrame(final_view, columns=['school', 'count_score', 'faculty_count', 'faculty_member', 'number_of_publications', 'adjusted_count', 'titles'])
    df_final = df_final.sort_values(by=['count_score', 'adjusted_count'], ascending=False)
    # print(df_final.head(10))
    # print(len(df))


    ## v2 
    # Grouping by 'school' to prepare the first table
    school_summary = df_final.groupby(['school', 'count_score', 'faculty_count'], sort=False).size().reset_index(name='count')
    school_summary = school_summary.drop('count', axis=1)
    school_summary['Rank'] = range(1, len(school_summary) + 1)
    # Rename columns
    school_summary = school_summary.rename(columns={
        'count_score': 'Score',
        'school': 'School',
        'faculty_count': 'Faculty #'
    })
    # Reorder columns to place 'Rank' first
    school_summary = school_summary[['Rank', "School", 'Score', 'Faculty #']]

    # update & which throws an error on front-end
    # school_summary = school_summary.applymap(lambda x: x.replace('&', '&amp;') if isinstance(x, str) else x)

    # Prepare data for the second table (faculty info)
    faculty_details = df_final[['school', 'faculty_member', 'number_of_publications', 'adjusted_count']]
    

    # Prepare data for the third table (paper titles info)
    paper_details = df_final[['school', 'faculty_member', 'titles']]
    print(paper_details.head())

    # print(school_summary.head())

    school_table_html = school_summary.to_html(classes='table table-bordered table-hover school-table', index=False)
    faculty_table_html = faculty_details.to_html(classes='table table-bordered table-hover', index=False)
    paper_table_html = paper_details.to_html(classes='table table-bordered table-hover', index=False)
    
    return render_template('index.html', school_table_html=school_table_html, faculty_table_html=faculty_table_html, paper_table_html=paper_table_html, first_load=first_load)

    # ## v1 
    # ## return this information in a series of drop downs
    # to_ret_html = ''
    # this_rank = 1
    # for this_school, school_group in df_final.groupby('school', sort=False):

    #     # print(this_school)

    #     outer = ''

    #     starter =   '''<details>'''
    #     ender =     '''</details>'''
    #     this_school_count_score = school_group['count_score'].unique()[0]
    #     this_school_table_info = ''
    #     this_school_table_start = '<table>'
    #     this_school_table_ender = '</table>'
    #     this_school_table_headers = '''
    #         <tr style='display:none;'>
    #             <th>#</th>
    #             <th>School</th>
    #             <th>(score) (No. faculty)</th>
    #         </tr>
    #     '''
    #     this_school_average_count = str(school_group['count_score'].unique()[0])
    #     this_school_faculty_count = str(school_group['faculty_count'].unique()[0])
    #     merged_average_count___faculty_count = this_school_average_count + " | " + this_school_faculty_count 
    #     this_school_row_info = '<tr>' + "<td>" + '<nobr class="monospace-text">' + str(this_rank).zfill(3) + '</nobr>' + '&ensp;  &emsp;'+ this_school + "</td>" + "<td>" + merged_average_count___faculty_count + "</td>" + '</tr>'
    #     this_school_table_info += this_school_table_start + this_school_table_headers + this_school_row_info + this_school_table_ender
    #     school_header = '''<summary class="center">''' + this_school_table_info + '''</summary>'''

    #     inner = ''

    #     table_start = '<table class="indented">'
    #     table_ender = '</table>'
    #     table_headers = '''
    #         <tr>
    #             <th>Faculty Member</th>
    #             <th>Number of Publications</th>
    #             <th>Adjusted Count</th>
    #         </tr>
    #     '''
    #     faculty_table_row = ''
    #     for i,r in school_group.iterrows():
    #         this_faculty = str(r['faculty_member'])
    #         this_faculty_num_publications = str(r['number_of_publications'])
    #         this_faculty_adjusted_count = str(r['adjusted_count'])

    #         faculty_table_row += '<tr>' + "<td>" + this_faculty + "</td>" + "<td>" + this_faculty_num_publications + "</td>" + "<td>" + this_faculty_adjusted_count + "</td>" + '</tr>'

    #     inner += table_start + table_headers + faculty_table_row + table_ender

    #     outer += starter + school_header + inner + ender

    #     to_ret_html += outer

    #     this_rank += 1


    # to_ret_html = to_ret_html 
    # return render_template('index.html', var=to_ret_html)





if __name__ == '__main__':
    app.run(debug=True)