###important weights

number of students which can fit in the dorm, must be first calculated, should be around 150(this would mean they get 100 percent, which would contribute by 40 to the final score), 40percent

bar and gym utilization, 25 percent, no congestion when these are used, enough space for people, we need to measure a good way for utilization, so if people have more tiles around them free or they dont have to wait long so they have enough space? we can have a threshold for utilization, like if they have at least 2 tiles around them free, or they dont have to wait more than x time to enter the bar/gym.

congestion in the hallways 15 percent when people are going somewhere, 

how long they have to wait path to desired locations 20 percent. (congestion is the corridor, if they have space, and path depends on agent location, so these could have different weights)


add exit scenario (everyone tries to exit and we measure the congestion/how easy it is to exist) to the simulation sweep, maybe just a few minutes for everyone to exit the building and go to the outside area. 5% of total score is based on this( this is added to congestion, and we dont use the path length).(maybe just a few minutes added due to this scenario)

also we should have the maximum number of agents possible put into all the generated rooms, so number of agents in reality is a max number not exact, so we always try to max out the number of agents in the building.


so agent number selection needs to be gone, since we always max out the number of agents in the building.


## other important parameters
Bar and gym sizes should be a range of height and width, not just fixed sizes, so we get all combinations of sizes.
we also need to be able to change the position of bar and gym based on parameters, current is random but can be also parameterized, maybe a range of locations?(min-max calculated based on height and weight?)
seed can be removed from the parameters, always default to random seed.
