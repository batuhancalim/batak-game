import random
import json

SUITS = ['H', 'S', 'D', 'C'] # Hearts, Spades, Diamonds, Clubs (Red, Black, Red, Black)
VALUES = range(2, 15) # 11:J, 12:Q, 13:K, 14:A

def get_deck():
    return [{'suit': s, 'value': v} for s in SUITS for v in VALUES]

class GameEngine:
    def __init__(self):
        self.players = {} # socket_id -> {'name': str, 'position': int (0=South, 1=West, 2=North, 3=East)}
        self.positions = [None, None, None, None] # 0, 1, 2, 3
        self.state = 'LOBBY' # LOBBY, DEALING, BIDDING, PLAYING, ROUND_END
        self.hands = {} # position -> [cards]
        self.scores = {0: 0, 1: 0} # Team 0 (0,2), Team 1 (1,3)
        self.reset_round()
        self.total_scores = {0: 0, 1: 0}
        
    def reset_round(self):
        self.bids = {} # position -> bid_amount
        self.current_bid = 0
        self.highest_bidder = None # position
        self.trump_suit = None
        self.current_turn = None # position
        self.bidding_turn = None # position
        self.dealer = getattr(self, 'dealer', 0)
        self.first_to_bid = (self.dealer + 1) % 4
        self.passed_players = set()
        self.trick_cards = {} # position -> card
        self.trick_leader = None
        self.tricks_won = {0: 0, 1: 0, 2: 0, 3: 0}
        self.partner_cards_revealed = False
        self.cards_played_in_round = 0
        
    def add_player(self, sid, name):
        if self.state != 'LOBBY': return False, "Oyun şu an devam ediyor."
        if len(self.players) >= 4: return False, "Masa dolu."
        
        pos = 0
        while self.positions[pos] is not None:
            pos += 1
            
        self.players[sid] = {'name': name, 'position': pos}
        self.positions[pos] = sid
        
        if len(self.players) == 4:
            # Start game timer or directly start
            pass
        return True, "Katıldınız"
        
    def remove_player(self, sid):
        if sid in self.players:
            pos = self.players[sid]['position']
            self.positions[pos] = None
            del self.players[sid]
            self.state = 'LOBBY' # Abort game
            self.reset_round()
            self.total_scores = {0: 0, 1: 0}
            
    def start_game(self):
        if len(self.players) != 4: return False
        self.state = 'BIDDING'
        self.reset_round()
        self.deal_cards()
        self.bidding_turn = self.first_to_bid
        return True
        
    def deal_cards(self):
        deck = get_deck()
        random.shuffle(deck)
        self.hands = {i: [] for i in range(4)}
        for i in range(52):
            self.hands[i % 4].append(deck[i])
        
        # Sort hands
        for i in range(4):
            self.hands[i].sort(key=lambda c: (SUITS.index(c['suit']), c['value']), reverse=True)
            
    def handle_bid(self, pos, bid):
        if self.state != 'BIDDING' or self.bidding_turn != pos: return False, "Sıra sizde değil"
        
        if bid == 0: # Pass
            self.passed_players.add(pos)
        else:
            if bid < 8 and bid != 0: return False, "İhale en az 8'den başlar"
            if bid <= self.current_bid: return False, "Mevcut ihaleden yüksek söylemelisiniz"
            self.current_bid = bid
            self.highest_bidder = pos
            
        next_pos = (pos + 1) % 4
        while next_pos in self.passed_players and len(self.passed_players) < 4:
            next_pos = (next_pos + 1) % 4
            
        if len(self.passed_players) == 4:
            # İlk konuşmak zorunda olan kişiye (veya o el başlayan kişiye) 7'den kalır
            forced_pos = self.first_to_bid
            self.current_bid = 7 # Herkes pas derse ihale 7 kalır
            self.highest_bidder = forced_pos
            self.state = 'WAITING_TRUMP'
            self.current_turn = forced_pos
            self.trick_leader = forced_pos
            return True, "İhale 7'den ilk oyuncuya kaldı. Lütfen koz belirleyin."
        elif len(self.passed_players) == 3 and self.highest_bidder is not None:
            self.state = 'WAITING_TRUMP'
            self.current_turn = self.highest_bidder
        else:
            self.bidding_turn = next_pos
            
        return True, ""
        
    def set_trump(self, pos, suit):
        if self.state != 'WAITING_TRUMP' or pos != self.highest_bidder: return False, "Sıra sizde değil"
        if suit not in SUITS: return False, "Geçersiz koz"
        
        self.trump_suit = suit
        self.state = 'PLAYING'
        self.current_turn = self.highest_bidder
        self.trick_leader = self.highest_bidder
        self.partner_cards_revealed = True  # Açmalı eşli - partner revealed!
        return True, ""
        
    def play_card(self, pos, card_index, target_pos=None):
        if self.state != 'PLAYING': return False, "Oyun şu an oynama aşamasında değil"
        
        if target_pos is None: target_pos = pos
        
        # Validation: Is sender allowed to play for target_pos?
        is_owner = (pos == target_pos)
        partner_pos = (self.highest_bidder + 2) % 4
        is_bidder_for_partner = (pos == self.highest_bidder and target_pos == partner_pos)
        
        if not (is_owner or is_bidder_for_partner):
            return False, "Bu oyuncu adına kart oynayamazsınız!"
            
        if self.current_turn != target_pos:
            return False, "Şu an bu oyuncunun sırası değil!"
            
        if card_index < 0 or card_index >= len(self.hands[target_pos]):
            return False, "Geçersiz kart"
            
        card = self.hands[target_pos][card_index]
        
        # Validate move
        if not self.is_valid_move(target_pos, card):
            return False, "Kurallara aykırı hamle (Renge uymalı veya koz atmalısınız)"
            
        # Play card
        self.hands[target_pos].pop(card_index)
        self.trick_cards[self.current_turn] = card
        
        # Check trick end
        if len(self.trick_cards) == 4:
            winner_pos = self.evaluate_trick()
            self.tricks_won[winner_pos] += 1
            self.current_turn = winner_pos # Winner starts next
            self.trick_leader = winner_pos
            self.cards_played_in_round += 4
            
            # Note: We don't clear trick_cards immediately here so clients can see it.
            # We will clear it on the next user action or via an explicit 'next_trick' call.
        else:
            self.current_turn = (self.current_turn + 1) % 4
            
        return True, ""

    def get_highest_card_in_suit(self, trick_cards_dict, suit):
        highest_val = -1
        for p, c in trick_cards_dict.items():
            if c['suit'] == suit and c['value'] > highest_val:
                highest_val = c['value']
        return highest_val

    def is_valid_move(self, pos, card):
        if len(self.trick_cards) == 0:
            return True # Can lead anything
            
        led_suit = self.trick_cards[self.trick_leader]['suit']
        has_led_suit = any(c['suit'] == led_suit for c in self.hands[pos])
        has_trump = any(c['suit'] == self.trump_suit for c in self.hands[pos])
        
        if led_suit == self.trump_suit:
            # Led with trump
            if card['suit'] == self.trump_suit:
                highest_trump = self.get_highest_card_in_suit(self.trick_cards, self.trump_suit)
                if card['value'] > highest_trump:
                    return True # Topped the trump
                elif any(c['suit'] == self.trump_suit and c['value'] > highest_trump for c in self.hands[pos]):
                    return False # Must top if possible
                else:
                    return True # Followed suit but couldn't top
            else:
                if has_led_suit: return False # Must follow suit
                return True # Void in trump, can play anything
        else:
            # Led with non-trump
            if card['suit'] == led_suit:
                highest_led = self.get_highest_card_in_suit(self.trick_cards, led_suit)
                if card['value'] > highest_led:
                    return True
                elif any(c['suit'] == led_suit and c['value'] > highest_led for c in self.hands[pos]):
                    return False # Must top if possible
                return True # Followed suit but couldn't top
                
            if has_led_suit:
                return False # Didn't follow suit but has it
                
            # Doesn't have led suit
            if card['suit'] == self.trump_suit:
                highest_trump = self.get_highest_card_in_suit(self.trick_cards, self.trump_suit)
                if highest_trump > 0:
                    if card['value'] > highest_trump:
                        return True
                    elif any(c['suit'] == self.trump_suit and c['value'] > highest_trump for c in self.hands[pos]):
                        return False # Must top existing trump
                    else:
                        return True
                return True # First to trump
                
            if has_trump:
                return False # Must play trump if void in led suit
                
            return True

    def evaluate_trick(self):
        led_suit = self.trick_cards[self.trick_leader]['suit']
        highest_trump_val = -1
        trump_winner = None
        
        highest_led_val = -1
        led_winner = None
        
        for pos, card in self.trick_cards.items():
            if card['suit'] == self.trump_suit:
                if card['value'] > highest_trump_val:
                    highest_trump_val = card['value']
                    trump_winner = pos
            elif card['suit'] == led_suit:
                if card['value'] > highest_led_val:
                    highest_led_val = card['value']
                    led_winner = pos
                    
        return trump_winner if trump_winner is not None else led_winner
        
    def clear_trick(self):
        self.trick_cards = {}
        if self.cards_played_in_round == 52:
            self.end_round()
            
    def end_round(self):
        team0_tricks = self.tricks_won[0] + self.tricks_won[2]
        team1_tricks = self.tricks_won[1] + self.tricks_won[3]
        
        bidder_team = 0 if self.highest_bidder in (0, 2) else 1
        other_team = 1 - bidder_team
        
        bid = self.current_bid
        bidder_tricks = team0_tricks if bidder_team == 0 else team1_tricks
        other_tricks = team1_tricks if bidder_team == 0 else team0_tricks
        
        # Standard scoring: bidder team
        if bidder_tricks >= bid:
            self.total_scores[bidder_team] += bidder_tricks
        else:
            self.total_scores[bidder_team] -= bid
            
        # Standard scoring: other team
        self.total_scores[other_team] += other_tricks
        
        # BATMA RULE: if any team takes fewer than 2 tricks, they lose 'bid' extra points
        if team0_tricks < 2:
            self.total_scores[0] -= bid
        if team1_tricks < 2:
            self.total_scores[1] -= bid
        
        self.state = 'ROUND_END'
        self.dealer = (self.dealer + 1) % 4
        
    def get_playable_card_indices(self, pos):
        """Returns which card indices are valid to play for this position."""
        if self.state != 'PLAYING':
            return []
            
        # CRITICAL FIX: If 4 cards are already on the table, no one can play until it's cleared!
        if len(self.trick_cards) >= 4:
            return []
        
        # Determine if this player can play at all
        partner_pos = (self.highest_bidder + 2) % 4 if self.highest_bidder is not None else -1
        can_play_own = self.current_turn == pos
        can_play_partner = (self.highest_bidder == pos and self.current_turn == partner_pos)
        
        if not can_play_own and not can_play_partner:
            return []
        
        actual_pos = partner_pos if can_play_partner else pos
        hand = self.hands.get(actual_pos, [])
        return [i for i, card in enumerate(hand) if self.is_valid_move(actual_pos, card)]

    def get_state_for_player(self, sid):
        if sid not in self.players: return None
        pos = self.players[sid]['position']
        
        # Build hands view
        visible_hands = {}
        for i in range(4):
            if i == pos:
                visible_hands[i] = self.hands.get(i, [])
            elif self.partner_cards_revealed and i == (self.highest_bidder + 2) % 4:
                visible_hands[i] = self.hands.get(i, [])  # Partner of bidder is revealed
            else:
                visible_hands[i] = [{'suit': '?', 'value': 0} for _ in range(len(self.hands.get(i, [])))]

        playable_indices = self.get_playable_card_indices(pos)

        return {
            'state': self.state,
            'my_position': pos,
            'players': {p: data['name'] for s, data in self.players.items() for p in [data['position']]},
            'hands': visible_hands,
            'bids': self.bids,
            'current_bid': self.current_bid,
            'highest_bidder': self.highest_bidder,
            'bidding_turn': self.bidding_turn,
            'trump_suit': self.trump_suit,
            'current_turn': self.current_turn,
            'trick_cards': self.trick_cards,
            'trick_leader': self.trick_leader,
            'tricks_won': self.tricks_won,
            'total_scores': self.total_scores,
            'passed_players': list(self.passed_players),
            'playable_indices': playable_indices
        }
